package com.family.messenger.call

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** 거절 / 끊기 buttons on the call notifications. */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_DECLINE -> CallManager.decline()
            ACTION_HANG_UP -> CallManager.hangUp()
        }
    }

    companion object {
        const val ACTION_DECLINE = "com.family.messenger.call.DECLINE"
        const val ACTION_HANG_UP = "com.family.messenger.call.HANG_UP"
    }
}
