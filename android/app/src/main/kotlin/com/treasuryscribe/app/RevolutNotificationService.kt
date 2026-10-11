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
import org.json.JSONArray
import org.json.JSONObject

class RevolutNotificationService : NotificationListenerService() {

    companion object {
        const val REVOLUT_PACKAGE = "com.revolut.revolut"
        const val EVENT_NOTIFICATION_RECEIVED = "notificationReceived"
        /** Body Android 15+ substitutes for OTP-looking content when the
         * listener lacks RECEIVE_SENSITIVE_NOTIFICATIONS (signature-only).
         * Mirrors REDACTED_NOTIFICATION_BODY in NotificationServiceCore.ts. */
        const val REDACTED_BODY = "Sensitive notification content hidden"
        private const val CHANNEL_ID = "treasury_scribe_channel"
        private const val FOREGROUND_NOTIFICATION_ID = 1001
        private const val FOREGROUND_NOTIFICATION_TEXT =
            "Treasury Scribe — Monitoring notifications"
        private const val RESTART_DELAY_MS = 5_000L
        private const val PENDING_PREFS = "revolut_pending_queue"
        private const val PENDING_KEY = "queue"

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
        // Recover notifications queued while the app was closed, even if the
        // service process died in between. Queued items survive swipes —
        // only a dead service at post time loses anything.
        restorePending()
        // The plugin may have loaded (no-op flushing to a dead service) while
        // this service was dead: deliver restored items now so they arrive
        // this open, not the next. Shade-rescan overlap is deduped by the
        // TS-side processed-shade guard.
        pluginInstance?.let { flushPendingNotifications(it) }
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

    override fun onListenerConnected() {
        super.onListenerConnected()
        // Re-process persistent notifications still sitting in the shade
        // (e.g. service was killed and restarted while a Revolut push
        // was never swiped away). Same path as live posts.
        rescanActiveNotifications()
    }

    /**
     * Actively visible Revolut notifications, excluding group summaries.
     * Wraps [NotificationListenerService.getActiveNotifications], which is
     * only callable once the listener is bound — returns empty otherwise.
     */
    fun getRevolutActiveNotifications(): List<StatusBarNotification> {
        return try {
            super.getActiveNotifications()
                ?.filter { sbn ->
                    sbn.packageName == REVOLUT_PACKAGE &&
                        (sbn.notification?.flags ?: 0) and Notification.FLAG_GROUP_SUMMARY == 0
                }
                .orEmpty()
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun rescanActiveNotifications() {
        for (sbn in getRevolutActiveNotifications()) {
            val data = toNotificationData(sbn) ?: continue
            deliverOrQueue(data)
        }
    }

    /**
     * Dispatches to the WebView when it is alive, otherwise queues for later.
     * The queue is persisted so items survive a service restart — a Revolut
     * push swiped away 1s after display is still captured on next app open.
     */
    private fun deliverOrQueue(data: JSObject) {
        val plugin = pluginInstance
        if (plugin != null) {
            plugin.dispatchNotificationReceived(data)
        } else {
            synchronized(pendingNotifications) {
                pendingNotifications.add(data)
                persistPendingLocked()
            }
        }
    }

    private fun prefs() = getSharedPreferences(PENDING_PREFS, MODE_PRIVATE)

    private fun persistPendingLocked() {
        try {
            val arr = JSONArray()
            for (data in pendingNotifications) {
                arr.put(
                    JSONObject().apply {
                        put("title", data.optString("title"))
                        put("body", data.optString("body"))
                        put("packageName", data.optString("packageName"))
                        put("postedAt", data.optString("postedAt"))
                    }
                )
            }
            prefs().edit().putString(PENDING_KEY, arr.toString()).apply()
        } catch (_: Exception) {
            // Persistence is best-effort; the in-memory queue still works.
        }
    }

    private fun restorePending() {
        try {
            val raw = prefs().getString(PENDING_KEY, null) ?: return
            val arr = JSONArray(raw)
            synchronized(pendingNotifications) {
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    pendingNotifications.add(
                        JSObject().apply {
                            put("title", o.optString("title"))
                            put("body", o.optString("body"))
                            put("packageName", o.optString("packageName"))
                            put("postedAt", o.optString("postedAt"))
                        }
                    )
                }
            }
        } catch (_: Exception) {
            // Corrupt store: start with an empty queue.
        }
    }

    private fun clearPersistedPending() {
        try {
            prefs().edit().remove(PENDING_KEY).apply()
        } catch (_: Exception) {
        }
    }

    private fun toNotificationData(sbn: StatusBarNotification): JSObject? {
        if (sbn.packageName != REVOLUT_PACKAGE) return null

        // Skip group summary notifications (Android creates these for 4+ notification groups)
        // They typically have empty body and no useful transaction data.
        if ((sbn.notification?.flags ?: 0) and Notification.FLAG_GROUP_SUMMARY != 0) return null

        val extras = sbn.notification?.extras ?: return null
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val body = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""

        // Android 15+ redaction: unrecoverable without the signature-level
        // permission, so drop before queue/bridge. The TS ingestion guard
        // (IngestionService step 0) is the backstop for the snapshot path.
        if (body == REDACTED_BODY) return null

        return JSObject().apply {
            put("title", title)
            put("body", body)
            put("packageName", REVOLUT_PACKAGE)
            put("postedAt", formatPostedAt(sbn.postTime))
        }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return
        val data = toNotificationData(sbn) ?: return
        deliverOrQueue(data)
    }

    fun flushPendingNotifications(plugin: NotificationListenerPlugin) {
        val queued: List<JSObject>
        synchronized(pendingNotifications) {
            queued = pendingNotifications.toList()
            pendingNotifications.clear()
        }
        clearPersistedPending()
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
