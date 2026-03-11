package com.vitobudget.tracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * ServiceRestartReceiver
 *
 * Receives an AlarmManager broadcast scheduled by [RevolutNotificationService.onDestroy]
 * and restarts the foreground service within ~5 seconds of it being killed.
 */
class ServiceRestartReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val serviceIntent = Intent(context, RevolutNotificationService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent)
        } else {
            context.startService(serviceIntent)
        }
    }
}
