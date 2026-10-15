package com.family.messenger.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.family.messenger.MainActivity
import com.family.messenger.R
import com.family.messenger.data.Message

object Notifications {
    private const val CHANNEL_MESSAGES = "messages"
    private const val CHANNEL_SERVICE = "connection"
    const val SERVICE_ID = 1

    fun createChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_MESSAGES, "새 메시지", NotificationManager.IMPORTANCE_HIGH),
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_SERVICE, "실시간 연결", NotificationManager.IMPORTANCE_MIN).apply {
                description = "새 메시지를 바로 받기 위해 서버와 연결을 유지합니다."
                setShowBadge(false)
            },
        )
    }

    fun service(context: Context): Notification =
        NotificationCompat.Builder(context, CHANNEL_SERVICE)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("가족 메신저")
            .setContentText("새 메시지를 기다리는 중")
            .setOngoing(true)
            .setContentIntent(openIntent(context, null, null))
            .build()

    fun showMessage(context: Context, message: Message, isGroup: Boolean) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        val title = if (isGroup) "우리 가족" else message.senderName
        val text = if (isGroup) "${message.senderName}: ${message.preview}" else message.preview
        val notification = NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setWhen(message.createdAt)
            .setContentIntent(openIntent(context, message.conversationId, title))
            .build()
        try {
            manager.notify(message.conversationId.hashCode(), notification)
        } catch (_: SecurityException) {
            // Notification permission was revoked; nothing to show.
        }
    }

    fun cancel(context: Context, conversationId: String) {
        NotificationManagerCompat.from(context).cancel(conversationId.hashCode())
    }

    private fun openIntent(context: Context, conversationId: String?, title: String?): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(MainActivity.EXTRA_CONVERSATION_ID, conversationId)
            putExtra(MainActivity.EXTRA_TITLE, title)
        }
        return PendingIntent.getActivity(
            context,
            conversationId?.hashCode() ?: 0,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}
