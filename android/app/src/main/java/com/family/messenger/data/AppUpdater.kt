package com.family.messenger.data

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.IntentCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/**
 * Updates the app from inside the app: downloads the newest APK from the family server and hands
 * it to Android's installer, so updating is one tap instead of browser download + warnings.
 */
class AppUpdater(private val context: Context, private val api: Api) {

    /** False until the person allows this app to install updates (asked once, in system settings). */
    fun canInstall(): Boolean = context.packageManager.canRequestPackageInstalls()

    fun openInstallPermissionSettings() {
        context.startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    /**
     * Downloads and starts installing. [onProgress] gets 0..1 and whether it's reconnecting after a
     * dropped connection. A broken download resumes where it stopped, also on the next tap.
     */
    suspend fun downloadAndInstall(onProgress: (Float, Boolean) -> Unit) = withContext(Dispatchers.IO) {
        val apk = download(onProgress)
        install(apk)
        apk.delete()
        etagFile.delete()
    }

    private val partFile = File(context.cacheDir, "update.apk.part")
    private val etagFile = File(context.cacheDir, "update.apk.etag")

    private suspend fun download(onProgress: (Float, Boolean) -> Unit): File {
        var failures = 0
        while (true) {
            try {
                if (downloadRest { onProgress(it, false) }) return partFile
            } catch (e: IOException) {
                if (++failures > MAX_RETRIES) {
                    throw ApiException("연결이 끊겨 업데이트를 다 받지 못했어요. 다시 누르면 이어서 받아요.")
                }
                onProgress(progressSoFar(), true)
                delay(2_000L * failures)
            }
        }
    }

    private var expectedSize = 0L
    private fun progressSoFar() = if (expectedSize > 0) partFile.length().toFloat() / expectedSize else 0f

    /** Fetches whatever part of the APK is still missing. True when the file is complete. */
    private fun downloadRest(onProgress: (Float) -> Unit): Boolean {
        val savedEtag = etagFile.takeIf { it.exists() }?.readText()
        if (savedEtag == null) partFile.delete()
        val have = partFile.length()
        val url = api.url("/app/family.apk") + "?t=" + System.currentTimeMillis()
        val request = Request.Builder().url(url).apply { if (have > 0) header("Range", "bytes=$have-") }.build()
        api.client.newCall(request).execute().use { response ->
            // The saved part is as long as (or longer than) the file now on the server, which may be a
            // different build, so start over rather than install a stale file.
            if (response.code == 416) {
                partFile.delete()
                etagFile.delete()
                return false
            }
            if (response.code >= 500) throw IOException("server ${response.code}")
            if (!response.isSuccessful) throw ApiException("업데이트를 받을 수 없습니다. (${response.code})", response.code)
            val etag = response.header("ETag").orEmpty()
            // A different file on the server (a newer build) means starting over.
            val resume = response.code == 206 && have > 0 && etag == savedEtag
            if (!resume && have > 0) {
                partFile.delete()
                if (response.code == 206) return false
            }
            etagFile.writeText(etag)
            val body = response.body ?: throw IOException("empty body")
            val start = if (resume) have else 0L
            expectedSize = if (body.contentLength() > 0) start + body.contentLength() else 0L
            FileOutputStream(partFile, resume).use { out ->
                body.byteStream().use { input ->
                    val buffer = ByteArray(64 * 1024)
                    var done = start
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        out.write(buffer, 0, n)
                        done += n
                        if (expectedSize > 0) onProgress(done.toFloat() / expectedSize)
                    }
                }
            }
            return expectedSize <= 0 || partFile.length() >= expectedSize
        }
    }

    private fun install(apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            // Once this app installed itself, later updates can go through without a confirm screen.
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            try {
                session.openWrite("family.apk", 0, apk.length()).use { out ->
                    apk.inputStream().use { it.copyTo(out) }
                    session.fsync(out)
                }
                val callback = PendingIntent.getBroadcast(
                    context,
                    sessionId,
                    Intent(context, UpdateReceiver::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
                )
                session.commit(callback.intentSender)
            } catch (e: Exception) {
                session.abandon()
                throw e
            }
        }
    }

    private companion object {
        /** Reconnect attempts per tap (waiting 2, 4, … 12 seconds) before asking to tap again. */
        const val MAX_RETRIES = 6
    }
}

/** Hears back from the installer: shows Android's confirm screen, or says why it failed. */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java)?.let {
                    context.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
            }
            PackageInstaller.STATUS_SUCCESS -> Unit
            PackageInstaller.STATUS_FAILURE_ABORTED -> Unit
            else -> {
                val reason = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE).orEmpty()
                Toast.makeText(context, "업데이트 설치에 실패했어요. $reason", Toast.LENGTH_LONG).show()
            }
        }
    }
}
