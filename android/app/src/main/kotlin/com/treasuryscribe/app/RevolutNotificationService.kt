package com.treasuryscribe.app

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import com.getcapacitor.JSObject
import org.json.JSONArray
import org.json.JSONObject
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

        /** Durable on-disk queue of notifications captured while the JS/WebView
         *  was not alive. Drained by the JS layer on app startup via
         *  `NotificationListener.drainQueuedNotifications()`. */
        private const val QUEUE_PREFS = "revolut_notification_queue"
        private const val QUEUE_KEY = "queued_notifications"
        private const val QUEUE_TAG = "RevolutNotificationQ"
        /** Soft cap to keep prefs payload bounded; older entries are dropped
         *  first. 500 spending notifications is several months of history. */
        private const val QUEUE_MAX_ENTRIES = 500

        @Volatile
        var pluginInstance: NotificationListenerPlugin? = null

        @Volatile
        var serviceInstance: RevolutNotificationService? = null

        fun formatPostedAt(postTime: Long): String {
            return SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }.format(Date(postTime))
        }

        /** Appends a captured notification to the durable disk queue. Safe to
         *  call from any thread — synchronizes on the prefs file via the
         *  SharedPreferences contract. */
        @Synchronized
        fun appendToDurableQueue(context: Context, data: JSObject) {
            try {
                val prefs = context.applicationContext
                    .getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE)
                val raw = prefs.getString(QUEUE_KEY, "[]") ?: "[]"
                val arr = try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
                arr.put(JSONObject(data.toString()))
                // Drop oldest entries if we exceed the cap. The queue is FIFO.
                val pruned = if (arr.length() > QUEUE_MAX_ENTRIES) {
                    val excess = arr.length() - QUEUE_MAX_ENTRIES
                    val kept = JSONArray()
                    for (i in excess until arr.length()) kept.put(arr.get(i))
                    kept
                } else arr
                prefs.edit().putString(QUEUE_KEY, pruned.toString()).apply()
            } catch (t: Throwable) {
                Log.w(QUEUE_TAG, "Failed to enqueue notification to durable store", t)
            }
        }

        /** Atomically reads and clears the durable queue. Returns an empty
         *  JSONArray on any error. */
        @Synchronized
        fun drainDurableQueue(context: Context): JSONArray {
            return try {
                val prefs = context.applicationContext
                    .getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE)
                val raw = prefs.getString(QUEUE_KEY, "[]") ?: "[]"
                val arr = try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
                // Clear only after we've safely parsed the payload.
                prefs.edit().remove(QUEUE_KEY).apply()
                arr
            } catch (t: Throwable) {
                Log.w(QUEUE_TAG, "Failed to drain durable queue", t)
                JSONArray()
            }
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

    /**
     * Test-injection entry point — synthesizes a notification event identical
     * to one captured from a real Revolut post. Called by
     * [SmokeTestReceiver] in debug/smoke-test runs only.
     *
     * Required because modern Android (≥14) removed the `-p <pkg>` flag from
     * `cmd notification post`, so shell-posted notifications are always owned
     * by `com.android.shell` and the production
     * `if (sbn.packageName != REVOLUT_PACKAGE) return` filter rejects them —
     * leaving no way for the smoke harness to drive the capture pipeline.
     *
     * Production code never calls this; only [SmokeTestReceiver] does, and
     * only when the broadcast carries `treasuryScribeSmoke=true`.
     */
    fun injectSmokeTestNotification(title: String, body: String) {
        val data = JSObject().apply {
            put("title", title)
            put("body", body)
            put("packageName", REVOLUT_PACKAGE)
            put("postedAt", formatPostedAt(System.currentTimeMillis()))
        }
        appendToDurableQueue(applicationContext, data)
        val plugin = pluginInstance
        if (plugin != null) {
            plugin.dispatchNotificationReceived(data)
        } else {
            synchronized(pendingNotifications) {
                pendingNotifications.add(data)
            }
        }
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

        // Always append to the durable on-disk queue FIRST. This is what makes
        // background capture reliable: even if the WebView dies or the user
        // swipes the Revolut notification away before opening the app, the
        // event is persisted to disk and the JS layer drains it on next
        // startup. Without this, a notification dispatched to a dead plugin
        // was silently lost when the user dismissed the source notification.
        appendToDurableQueue(applicationContext, data)

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
