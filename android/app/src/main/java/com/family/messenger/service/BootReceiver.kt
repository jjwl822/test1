package com.family.messenger.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.family.messenger.FamilyApp

/** Reconnects after the phone restarts so notifications keep working. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val app = context.applicationContext as FamilyApp
        if (app.session.auth.value != null) MessageService.start(context)
    }
}
