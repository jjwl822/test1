package com.family.messenger.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.family.messenger.FamilyApp
import com.family.messenger.data.Api
import com.family.messenger.data.MessageBus
import com.family.messenger.data.SocketEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

/**
 * Keeps a WebSocket open to the family server so new messages arrive instantly and show up as
 * notifications even when the app is closed. Runs as a foreground service (remote messaging),
 * which is how Android lets an app without Google push services stay connected.
 */
class MessageService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val app get() = application as FamilyApp
    private val socketClient by lazy {
        app.api.client.newBuilder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(30, TimeUnit.SECONDS)
            .build()
    }

    private var socket: WebSocket? = null
    private var reconnectJob: Job? = null
    private var attempt = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING else 0
        ServiceCompat.startForeground(this, Notifications.SERVICE_ID, Notifications.service(this), type)
        if (app.session.auth.value == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (socket == null && reconnectJob?.isActive != true) connect()
        return START_STICKY
    }

    private fun connect() {
        val auth = app.session.auth.value ?: return stopSelf()
        val request = Request.Builder()
            .url(app.api.socketUrl())
            .header("Authorization", "Bearer ${auth.token}")
            .build()
        socket = socketClient.newWebSocket(request, Listener())
    }

    private fun scheduleReconnect() {
        socket = null
        MessageBus.connected.value = false
        if (app.session.auth.value == null) return stopSelf()
        val wait = (1L shl attempt.coerceAtMost(6)).coerceAtMost(60) * 1000
        attempt++
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(wait)
            connect()
        }
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            scope.launch {
                attempt = 0
                MessageBus.connected.value = true
            }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val event = runCatching { Api.json.decodeFromString<SocketEvent>(text) }.getOrNull() ?: return
            scope.launch { handle(event) }
        }

        private suspend fun handle(event: SocketEvent) {
            val me = app.session.auth.value?.user?.id
            val context = this@MessageService
            when (event.type) {
                "message" -> {
                    val message = event.message ?: return
                    MessageBus.messages.emit(message)
                    if (message.senderId != me && MessageBus.activeConversation.value != message.conversationId) {
                        Notifications.showMessage(context, message, message.conversationId == "family")
                    }
                }
                "post", "comment", "feed" -> {
                    val postId = event.postId ?: return
                    MessageBus.feedChanges.emit(postId)
                    if (MessageBus.activeConversation.value == MessageBus.FEED) return
                    if (event.type == "post" && event.authorId != me) {
                        Notifications.showStory(context, "${event.authorName}님이 새 스토리를 올렸어요")
                    }
                    val comment = event.comment
                    if (event.type == "comment" && comment != null && event.postAuthorId == me && comment.authorId != me) {
                        Notifications.showStory(context, "${comment.authorName}님의 댓글: ${comment.text}")
                    }
                }
            }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            scope.launch { if (socket === webSocket) scheduleReconnect() }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            scope.launch {
                if (socket !== webSocket) return@launch
                if (response?.code == 401) {
                    // The login is no longer valid on the server.
                    app.session.clear()
                }
                scheduleReconnect()
            }
        }
    }

    override fun onDestroy() {
        scope.cancel()
        socket?.close(1000, null)
        socket = null
        MessageBus.connected.value = false
        super.onDestroy()
    }

    companion object {
        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, MessageService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, MessageService::class.java))
        }
    }
}
