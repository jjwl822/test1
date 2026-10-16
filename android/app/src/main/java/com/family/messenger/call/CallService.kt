package com.family.messenger.call

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.family.messenger.service.Notifications
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** Keeps the microphone (and camera) working while the call screen is in the background. */
class CallService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var started = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val state = CallManager.state.value
        if (!state.inCall) {
            stopSelf()
            return START_NOT_STICKY
        }
        var type = 0
        if (Build.VERSION.SDK_INT >= 30) {
            if (granted(android.Manifest.permission.RECORD_AUDIO)) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            if (state.video && granted(android.Manifest.permission.CAMERA)) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        }
        runCatching {
            ServiceCompat.startForeground(this, Notifications.ONGOING_CALL_ID, Notifications.ongoingCall(this, state), type)
        }.onFailure {
            stopSelf()
            return START_NOT_STICKY
        }
        if (!started) {
            started = true
            scope.launch {
                CallManager.state.collect { if (!it.inCall) stopSelf() }
            }
        }
        return START_NOT_STICKY
    }

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    override fun onDestroy() {
        stopped()
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private var running = false

        fun start(context: Context) {
            if (running) return
            running = true
            runCatching { ContextCompat.startForegroundService(context, Intent(context, CallService::class.java)) }
                .onFailure { running = false }
        }

        internal fun stopped() {
            running = false
        }
    }
}
