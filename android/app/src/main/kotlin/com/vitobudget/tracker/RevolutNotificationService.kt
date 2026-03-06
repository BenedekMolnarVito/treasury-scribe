package com.vitobudget.tracker

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
import com.getcapacitor.Bridge

/**
 * RevolutNotificationService
 *
 * Android [NotificationListenerService] that monitors posted notifications,
 * filters to the Revolut application, and forwards payloads to the
 * Capacitor JavaScript layer via [NotificationListenerPlugin].
 *
 * The service runs as a foreground service with a persistent low-priority
 * notification to ensure it survives memory pressure on modern Android
 * versions.
 */
class RevolutNotificationService : NotificationListenerService() {

    companion object {
        /** Android package name for the Revolut application. */
        const val REVOLUT_PACKAGE = "com.revolut.revolut"

        /** Capacitor event name emitted to the JavaScript layer. */
        const val EVENT_NOTIFICATION_RECEIVED = "notificationReceived"

        /** Foreground service notification channel ID. */
        private const val CHANNEL_ID = "vito_budget_tracker_channel"

        /** Foreground service notification ID (must be > 0). */
        private const val FOREGROUND_NOTIFICATION_ID = 1001

        /**
         * Text shown in the persistent foreground service notification,
         * as specified in the acceptance criteria.
         */
        private const val FOREGROUND_NOTIFICATION_TEXT =
            "VitoBudget Tracker — Monitoring notifications"

        /**
         * Static reference to the active Capacitor [Bridge] instance.
         * Set by [NotificationListenerPlugin] when the plugin is loaded.
         */
        @Volatile
        var bridge: Bridge? = null
    }

    // -------------------------------------------------------------------------
    // Service lifecycle
    // -------------------------------------------------------------------------

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(FOREGROUND_NOTIFICATION_ID, buildForegroundNotification())
    }

    override fun onDestroy() {
        super.onDestroy()
        bridge = null
    }

    /**
     * Required override — binding is handled by the system for
     * [NotificationListenerService]; returning null here keeps default
     * system-managed binding.
     */
    override fun onBind(intent: Intent?): IBinder? {
        return super.onBind(intent)
    }

    // -------------------------------------------------------------------------
    // Notification listener callback
    // -------------------------------------------------------------------------

    /**
     * Called by the Android framework when any notification is posted.
     *
     * Only notifications from [REVOLUT_PACKAGE] are processed; all other
     * packages are silently ignored.
     *
     * Extracts `android.title` and `android.text` extras from the
     * notification and fires the [EVENT_NOTIFICATION_RECEIVED] Capacitor event.
     */
    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return

        // Silently ignore all non-Revolut packages
        if (sbn.packageName != REVOLUT_PACKAGE) return

        val extras = sbn.notification?.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val body = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""

        // Forward the payload to the Capacitor JavaScript layer
        bridge?.let { activeBridge ->
            val data = JSObject().apply {
                put("title", title)
                put("body", body)
                put("packageName", REVOLUT_PACKAGE)
            }
            activeBridge.triggerJSEvent(EVENT_NOTIFICATION_RECEIVED, "window", data.toString())
        }
    }

    // -------------------------------------------------------------------------
    // Foreground service notification helpers
    // -------------------------------------------------------------------------

    /**
     * Creates the notification channel required on Android 8+ (API 26+).
     *
     * The channel uses [NotificationManager.IMPORTANCE_LOW] so the persistent
     * foreground notification does not make sound or appear as a heads-up alert.
     */
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "VitoBudget Tracker",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Foreground service channel for notification monitoring"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    /**
     * Builds the persistent low-priority foreground service notification.
     *
     * The notification text matches the acceptance criteria verbatim:
     * *"VitoBudget Tracker — Monitoring notifications"*.
     */
    private fun buildForegroundNotification(): Notification {
        val intent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent, pendingIntentFlags
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("VitoBudget Tracker")
            .setContentText(FOREGROUND_NOTIFICATION_TEXT)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build()
    }
}
