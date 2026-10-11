package com.treasuryscribe.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock

/**
 * BootReceiver
 *
 * Receives [Intent.ACTION_BOOT_COMPLETED] and [Intent.ACTION_MY_PACKAGE_REPLACED]
 * broadcasts and restarts the [RevolutNotificationService] foreground service so
 * that notification monitoring resumes automatically after device reboot or app
 * update without requiring the user to reopen the app.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) return

        startMonitoringService(context)
    }

    private fun startMonitoringService(context: Context) {
        val serviceIntent = Intent(context, RevolutNotificationService::class.java)
        try {
            // startService() from a background receiver throws on API 26+, so
            // the foreground variant is required here (same as
            // ServiceRestartReceiver).
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
        } catch (_: Exception) {
            // Android 12+ can still refuse the background start
            // (ForegroundServiceStartNotAllowedException). Fall back to the
            // proven alarm path: ServiceRestartReceiver retries the start.
            scheduleRestartFallback(context)
        }
    }

    private fun scheduleRestartFallback(context: Context) {
        try {
            val restartIntent = Intent(context, ServiceRestartReceiver::class.java)
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            val pendingIntent = PendingIntent.getBroadcast(context, 0, restartIntent, flags)
            val alarmManager = context.getSystemService(AlarmManager::class.java) ?: return
            alarmManager.setExactAndAllowWhileIdle(
                AlarmManager.ELAPSED_REALTIME_WAKEUP,
                SystemClock.elapsedRealtime() + 5_000L,
                pendingIntent
            )
        } catch (_: Exception) {
            // Last resort failed; the service starts on next app open.
        }
    }
}
