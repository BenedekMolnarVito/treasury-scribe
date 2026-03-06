package com.vitobudget.tracker

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.text.TextUtils
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * NotificationListenerPlugin
 *
 * Capacitor 8 plugin that bridges Android notification-listener functionality
 * to the TypeScript / JavaScript layer.
 *
 * This plugin manages the [RevolutNotificationService] lifecycle and exposes
 * helpers for requesting the permissions required to keep the service running
 * reliably:
 *  - Notification Access ([android.service.notification.NotificationListenerService])
 *  - POST_NOTIFICATIONS runtime permission (Android 13+)
 *  - Battery optimization exclusion
 *  - MIUI / HyperOS autostart guidance
 *
 * All notification filtering and event emission is handled inside
 * [RevolutNotificationService]; this class is a thin bridge only.
 */
@CapacitorPlugin(name = "NotificationListener")
class NotificationListenerPlugin : Plugin() {

    companion object {
        /** Runtime permission constant available from API 33 (Android 13+). */
        private const val POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS"

        /** Request code used when launching POST_NOTIFICATIONS permission request. */
        private const val REQUEST_POST_NOTIFICATIONS = 2001

        /**
         * Known MIUI / HyperOS manufacturer values used to detect Xiaomi devices
         * that require manual autostart configuration.
         */
        private val MIUI_MANUFACTURERS = setOf("xiaomi", "redmi", "poco")
    }

    /** Pending call awaiting the POST_NOTIFICATIONS permission dialog result. */
    private var pendingPostNotificationsCall: PluginCall? = null

    // -------------------------------------------------------------------------
    // Plugin lifecycle
    // -------------------------------------------------------------------------

    override fun load() {
        super.load()
        // Provide the active Capacitor bridge to the service so it can fire
        // events back to JavaScript.
        RevolutNotificationService.bridge = bridge
    }

    // -------------------------------------------------------------------------
    // Plugin methods
    // -------------------------------------------------------------------------

    /**
     * Opens the system Notification Access settings screen.
     *
     * The user must manually enable access for this app. This method only
     * launches the intent; it does not wait for the result.
     */
    @PluginMethod
    fun openNotificationAccessSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }

    /**
     * Returns whether Notification Access has been granted for this app.
     *
     * Checks the enabled notification listeners via
     * [Settings.Secure.ENABLED_NOTIFICATION_LISTENERS].
     */
    @PluginMethod
    fun isNotificationAccessGranted(call: PluginCall) {
        val result = JSObject()
        result.put("granted", isNotificationListenerEnabled())
        call.resolve(result)
    }

    /**
     * Requests the POST_NOTIFICATIONS runtime permission on Android 13+.
     *
     * On earlier API levels resolves immediately with `{ granted: true }`.
     * On Android 13+ the call is held open until the user responds to the
     * system dialog; the final `{ granted: true/false }` is delivered via
     * [handleOnRequestPermissionsResult].
     */
    @PluginMethod
    fun requestPostNotificationsPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                context, POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED

            if (granted) {
                val result = JSObject()
                result.put("granted", true)
                call.resolve(result)
            } else {
                // Hold the call open and resolve it once the user responds.
                pendingPostNotificationsCall = call
                pluginRequestPermissions(arrayOf(POST_NOTIFICATIONS), REQUEST_POST_NOTIFICATIONS)
            }
        } else {
            val result = JSObject()
            result.put("granted", true)
            call.resolve(result)
        }
    }

    /**
     * Delivers the POST_NOTIFICATIONS permission dialog result back to the
     * waiting JavaScript call.
     */
    override fun handleOnRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray
    ) {
        super.handleOnRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_POST_NOTIFICATIONS) {
            val pending = pendingPostNotificationsCall ?: return
            pendingPostNotificationsCall = null
            val granted = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
            val result = JSObject()
            result.put("granted", granted)
            pending.resolve(result)
        }
    }

    /**
     * Opens the system Battery Optimization settings page for this app so the
     * user can exclude it from battery optimizations.
     */
    @PluginMethod
    fun openBatteryOptimizationSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = Uri.parse("package:${context.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        call.resolve()
    }

    /**
     * Returns whether this app is currently excluded from battery optimizations.
     */
    @PluginMethod
    fun isBatteryOptimizationExcluded(call: PluginCall) {
        val powerManager = context.getSystemService(PowerManager::class.java)
        val excluded = powerManager?.isIgnoringBatteryOptimizations(context.packageName) ?: false
        val result = JSObject()
        result.put("granted", excluded)
        call.resolve(result)
    }

    /**
     * On MIUI / HyperOS (Xiaomi) devices, attempts to open the autostart
     * management screen and resolves with `{ shown: true }`.
     *
     * On all other devices resolves with `{ shown: false }` without showing
     * any UI.
     */
    @PluginMethod
    fun showAutoStartGuidance(call: PluginCall) {
        val manufacturer = Build.MANUFACTURER.lowercase()
        val isMiui = MIUI_MANUFACTURERS.any { manufacturer.contains(it) }

        val result = JSObject()
        if (isMiui) {
            try {
                val intent = Intent().apply {
                    component = ComponentName(
                        "com.miui.securitycenter",
                        "com.miui.permcenter.autostart.AutoStartManagementActivity"
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
                result.put("shown", true)
            } catch (_: Exception) {
                // MIUI autostart activity not available on this firmware variant
                result.put("shown", false)
            }
        } else {
            result.put("shown", false)
        }
        call.resolve(result)
    }

    /**
     * Starts the [RevolutNotificationService] foreground service.
     *
     * Notification Access must be granted before calling this method.
     */
    @PluginMethod
    fun startListening(call: PluginCall) {
        RevolutNotificationService.bridge = bridge
        val intent = Intent(context, RevolutNotificationService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
        call.resolve()
    }

    /**
     * Stops the [RevolutNotificationService] foreground service.
     */
    @PluginMethod
    fun stopListening(call: PluginCall) {
        val intent = Intent(context, RevolutNotificationService::class.java)
        context.stopService(intent)
        call.resolve()
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Checks [Settings.Secure.ENABLED_NOTIFICATION_LISTENERS] to determine
     * whether this app's [RevolutNotificationService] has been granted
     * Notification Access by the user.
     */
    private fun isNotificationListenerEnabled(): Boolean {
        val flat = Settings.Secure.getString(
            context.contentResolver,
            "enabled_notification_listeners"
        ) ?: return false

        val packageName = context.packageName
        return flat.split(":").any { component ->
            component.startsWith("$packageName/")
        }
    }
}
