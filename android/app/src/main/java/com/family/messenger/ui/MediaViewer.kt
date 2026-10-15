package com.family.messenger.ui

import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import coil.compose.AsyncImage
import com.family.messenger.FamilyApp
import com.family.messenger.data.PostMedia

/** Full-screen viewer: swipe through a post's photos and videos; videos play when shown. */
@Composable
fun MediaViewer(app: FamilyApp, media: List<PostMedia>, startIndex: Int, onDismiss: () -> Unit) {
    val pager = rememberPagerState(initialPage = startIndex) { media.size }
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { page ->
                val item = media[page]
                when {
                    item.isVideo && pager.currentPage == page -> VideoPlayer(app, app.api.url(item.url))
                    else -> AsyncImage(
                        model = app.api.url(item.posterUrl ?: item.url),
                        contentDescription = if (item.isVideo) "동영상" else "사진",
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
            IconButton(onClick = onDismiss, modifier = Modifier.systemBarsPadding().align(Alignment.TopStart)) {
                Icon(Icons.Filled.Close, contentDescription = "닫기", tint = Color.White)
            }
            if (media.size > 1) {
                Text(
                    "${pager.currentPage + 1} / ${media.size}",
                    color = Color.White,
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.systemBarsPadding().align(Alignment.TopEnd).padding(16.dp),
                )
            }
        }
    }
}

@OptIn(UnstableApi::class)
@Composable
private fun VideoPlayer(app: FamilyApp, url: String) {
    val context = LocalContext.current
    val player = remember(url) {
        // Story videos need the login token, so playback goes through the app's HTTP client.
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(OkHttpDataSource.Factory(app.api.client)))
            .build()
            .apply {
                setMediaItem(MediaItem.fromUri(url))
                prepare()
                playWhenReady = true
            }
    }
    DisposableEffect(player) { onDispose { player.release() } }
    AndroidView(
        factory = { PlayerView(it).apply { this.player = player } },
        modifier = Modifier.fillMaxSize(),
    )
}
