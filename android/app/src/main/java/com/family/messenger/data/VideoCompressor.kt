package com.family.messenger.data

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Re-encodes videos on the phone before upload: 720p (short side), H.264 at ~2.5 Mbps, AAC audio.
 * A one-minute 4K clip of a few hundred MB becomes roughly 20 MB.
 */
object VideoCompressor {
    private const val SHORT_SIDE = 720
    private const val VIDEO_BITRATE = 2_500_000

    class Result(val video: File, val poster: ByteArray)

    @OptIn(UnstableApi::class)
    suspend fun compress(context: Context, uri: Uri, onProgress: (Int) -> Unit): Result {
        val (width, height) = withContext(Dispatchers.IO) { displaySize(context, uri) }
        val poster = withContext(Dispatchers.IO) { poster(context, uri) }
        val out = withContext(Dispatchers.IO) { File.createTempFile("upload", ".mp4", context.cacheDir) }

        // Presentation sees upright frames, so target the displayed height that makes the short side 720.
        val effects = if (min(width, height) > SHORT_SIDE) {
            val targetHeight = if (height <= width) SHORT_SIDE else (SHORT_SIDE.toFloat() * height / width).roundToInt()
            Effects(emptyList(), listOf(Presentation.createForHeight(targetHeight and 1.inv())))
        } else {
            Effects.EMPTY
        }
        val composition = Composition.Builder(
            EditedMediaItemSequence(EditedMediaItem.Builder(MediaItem.fromUri(uri)).setEffects(effects).build()),
        )
            // Many phones record HDR, which most encoders can't write; convert to normal (SDR) video.
            .setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL)
            .build()

        return withContext(Dispatchers.Main) {
            coroutineScope {
                var transformer: Transformer? = null
                val poll = launch {
                    val holder = ProgressHolder()
                    while (isActive) {
                        if (transformer?.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) onProgress(holder.progress)
                        delay(300)
                    }
                }
                try {
                    suspendCancellableCoroutine { cont ->
                        val t = Transformer.Builder(context)
                            .setVideoMimeType(MimeTypes.VIDEO_H264)
                            .setAudioMimeType(MimeTypes.AUDIO_AAC)
                            .setEncoderFactory(
                                DefaultEncoderFactory.Builder(context)
                                    .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(VIDEO_BITRATE).build())
                                    .build(),
                            )
                            .addListener(object : Transformer.Listener {
                                override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                                    cont.resume(Result(out, poster))
                                }

                                override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                                    out.delete()
                                    cont.resumeWithException(ApiException("동영상을 변환하지 못했습니다."))
                                }
                            })
                            .build()
                        transformer = t
                        cont.invokeOnCancellation {
                            // Transformer must be used on the main thread.
                            android.os.Handler(android.os.Looper.getMainLooper()).post {
                                t.cancel()
                                out.delete()
                            }
                        }
                        t.start(composition, out.absolutePath)
                    }
                } finally {
                    poll.cancel()
                }
            }
        }
    }

    /** Width and height as the video is displayed (rotation applied). */
    private fun displaySize(context: Context, uri: Uri): Pair<Int, Int> = retriever(context, uri) {
        val w = extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
        val h = extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
        val rotation = extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
        if (rotation == 90 || rotation == 270) h to w else w to h
    }

    /** First frame as a small JPEG, shown in the feed before the video is played. */
    private fun poster(context: Context, uri: Uri): ByteArray = retriever(context, uri) {
        val frame = getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
            ?: throw ApiException("동영상을 열 수 없습니다.")
        ImageCompressor.toJpeg(frame, maxSide = 1080, quality = 80)
    }

    private inline fun <T> retriever(context: Context, uri: Uri, block: MediaMetadataRetriever.() -> T): T {
        val retriever = MediaMetadataRetriever()
        try {
            retriever.setDataSource(context, uri)
            return retriever.block()
        } catch (e: RuntimeException) {
            throw ApiException("동영상을 열 수 없습니다.")
        } finally {
            retriever.release()
        }
    }
}
