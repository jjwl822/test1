package com.family.messenger.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import com.family.messenger.call.CallActionReceiver
import com.family.messenger.call.CallActivity
import com.family.messenger.call.CallManager
import com.family.messenger.MainActivity
import com.family.messenger.R
import com.family.messenger.data.Message
import com.family.messenger.data.MessageBus

object Notifications {
    private const val CHANNEL_MESSAGES = "messages"
    private const val CHANNEL_SERVICE = "connection"
    private const val CHANNEL_CALLS = "calls"
    private const val CHANNEL_ONGOING = "ongoing_call"
    const val SERVICE_ID = 1
    const val CALL_ID = 2
    const val ONGOING_CALL_ID = 3

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
        // The ringtone is played by CallManager (so it stops the moment the call is answered).
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_CALLS, "걸려오는 전화", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(null, null)
                enableVibration(false)
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ONGOING, "통화 중", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) },
        )
    }

    /** Shows the full-screen incoming-call notification while ringing, and removes it otherwise. */
    fun updateCall(context: Context, state: CallManager.State) {
        val manager = NotificationManagerCompat.from(context)
        if (state.status != CallManager.Status.INCOMING) {
            manager.cancel(CALL_ID)
            return
        }
        if (!manager.areNotificationsEnabled()) return
        val caller = Person.Builder().setName(state.peer?.displayName ?: "가족").setImportant(true).build()
        val answer = PendingIntent.getActivity(
            context,
            1,
            CallActivity.answerIntent(context),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val screen = PendingIntent.getActivity(
            context,
            2,
            CallActivity.showIntent(context),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val decline = PendingIntent.getBroadcast(
            context,
            3,
            Intent(context, CallActionReceiver::class.java).setAction(CallActionReceiver.ACTION_DECLINE),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("${caller.name}님의 ${if (state.video) "영상통화" else "음성통화"}")
            .setContentText("전화가 왔어요")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setContentIntent(screen)
            .setFullScreenIntent(screen, true)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer).setIsVideo(state.video))
            .build()
        try {
            manager.notify(CALL_ID, notification)
        } catch (_: SecurityException) {
            // Notification permission was revoked.
        } catch (_: IllegalArgumentException) {
            // The system refused the call style.
        }
    }

    /** The "통화 중" notification shown by CallService while a call is up. */
    fun ongoingCall(context: Context, state: CallManager.State): Notification {
        val hangUp = PendingIntent.getBroadcast(
            context,
            4,
            Intent(context, CallActionReceiver::class.java).setAction(CallActionReceiver.ACTION_HANG_UP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val screen = PendingIntent.getActivity(
            context,
            2,
            CallActivity.showIntent(context),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val person = Person.Builder().setName(state.peer?.displayName ?: "가족").build()
        return NotificationCompat.Builder(context, CHANNEL_ONGOING)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("${person.name}님과 통화 중")
            .setContentText("눌러서 통화 화면으로")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setContentIntent(screen)
            .setStyle(NotificationCompat.CallStyle.forOngoingCall(person, hangUp).setIsVideo(state.video))
            .build()
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

    fun showStory(context: Context, text: String) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        val notification = NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("가족 스토리")
            .setContentText(text)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(openIntent(context, MessageBus.FEED, "가족 스토리"))
            .build()
        try {
            manager.notify(MessageBus.FEED.hashCode(), notification)
        } catch (_: SecurityException) {
        }
    }

    /** Calendar ("내일 일정: 치과") and memory ("1년 전 오늘") reminders. [target] is the tab to open. */
    fun showReminder(context: Context, title: String, text: String, target: String) {
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return
        val notification = NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(openIntent(context, target, title))
            .build()
        try {
            manager.notify((title + text).hashCode(), notification)
        } catch (_: SecurityException) {
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
