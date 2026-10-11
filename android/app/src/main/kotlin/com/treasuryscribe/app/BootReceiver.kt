package com.treasuryscribe.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * BootReceiver
 *
 * Receives [Intent.ACTION_BOOT_COMPLETED] broadcasts and restarts the
 * [RevolutNotificationService] foreground service so that notification monitoring
 * resumes automatically after device reboot without requiring the user to reopen the app.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED) return

        val serviceIntent = Intent(context, RevolutNotificationService::class.java)
        // Use startService() to avoid ForegroundServiceStartNotAllowedException on Android 12+.
        // The service will call startForeground() in its onCreate() method.
        context.startService(serviceIntent)
    }
}
