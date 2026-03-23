package com.treasuryscribe.app

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import com.getcapacitor.JSObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class RevolutNotificationService : NotificationListenerService() {

    companion object {
        const val REVOLUT_PACKAGE = "com.revolut.revolut"
        const val EVENT_NOTIFICATION_RECEIVED = "notificationReceived"
        private const val CHANNEL_ID = "treasury_scribe_channel"
        private const val FOREGROUND_NOTIFICATION_ID = 1001
        private const val FOREGROUND_NOTIFICATION_TEXT =
            "Treasury Scribe — Monitoring notifications"
        private const val RESTART_DELAY_MS = 5_000L

        @Volatile
        var pluginInstance: NotificationListenerPlugin? = null

        @Volatile
        var serviceInstance: RevolutNotificationService? = null

        fun formatPostedAt(postTime: Long): String {
            return SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }.format(Date(postTime))
        }
    }

    private val pendingNotifications = mutableListOf<JSObject>()

    override fun onCreate() {
        super.onCreate()
        serviceInstance = this
        createNotificationChannel()
        startForeground(FOREGROUND_NOTIFICATION_ID, buildForegroundNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        pluginInstance = null
        serviceInstance = null
        scheduleRestart()
    }

    private fun scheduleRestart() {
        val restartIntent = Intent(this, ServiceRestartReceiver::class.java)
        val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pendingIntent = PendingIntent.getBroadcast(
            this, 0, restartIntent, pendingIntentFlags
        )
        val alarmManager = getSystemService(AlarmManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setExactAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                System.currentTimeMillis() + RESTART_DELAY_MS,
                pendingIntent
            )
        } else {
            alarmManager.setExact(
                AlarmManager.RTC_WAKEUP,
                System.currentTimeMillis() + RESTART_DELAY_MS,
                pendingIntent
            )
        }
    }

    override fun onBind(intent: Intent?): IBinder? {
        return super.onBind(intent)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return
        if (sbn.packageName != REVOLUT_PACKAGE) return

        val extras = sbn.notification?.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val body = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""

        val data = JSObject().apply {
            put("title", title)
            put("body", body)
            put("packageName", REVOLUT_PACKAGE)
            put("postedAt", formatPostedAt(sbn.postTime))
        }

        val plugin = pluginInstance
        if (plugin != null) {
            plugin.dispatchNotificationReceived(data)
        } else {
            synchronized(pendingNotifications) {
                pendingNotifications.add(data)
            }
        }
    }

    fun flushPendingNotifications(plugin: NotificationListenerPlugin) {
        val queued: List<JSObject>
        synchronized(pendingNotifications) {
            queued = pendingNotifications.toList()
            pendingNotifications.clear()
        }
        for (data in queued) {
            plugin.dispatchNotificationReceived(data)
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Treasury Scribe",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Foreground service channel for notification monitoring"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildForegroundNotification(): Notification {
        val launchIntent: Intent = packageManager.getLaunchIntentForPackage(packageName)
            ?: Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            }
        val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, launchIntent, pendingIntentFlags
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Treasury Scribe")
            .setContentText(FOREGROUND_NOTIFICATION_TEXT)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build()
    }
}
