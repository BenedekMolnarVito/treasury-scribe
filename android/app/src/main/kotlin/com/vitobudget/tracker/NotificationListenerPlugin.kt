package com.vitobudget.tracker
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
@CapacitorPlugin(name = "NotificationListener")
class NotificationListenerPlugin : Plugin() {
    companion object {
        private const val POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS"
        private const val REQUEST_POST_NOTIFICATIONS = 2001
        private val MIUI_MANUFACTURERS = setOf("xiaomi", "redmi", "poco")
    }
    private var pendingPostNotificationsCall: PluginCall? = null
    override fun load() {
        super.load()
        RevolutNotificationService.pluginInstance = this
    }
    fun dispatchNotificationReceived(data: JSObject) {
        super.notifyListeners("notificationReceived", data)
    }
    @PluginMethod
    fun openNotificationAccessSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }
    @PluginMethod
    fun isNotificationAccessGranted(call: PluginCall) {
        val result = JSObject()
        result.put("granted", isNotificationListenerEnabled())
        call.resolve(result)
    }
    @PluginMethod
    fun requestPostNotificationsPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                context,
                POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (granted) {
                val result = JSObject()
                result.put("granted", true)
                call.resolve(result)
            } else {
                pendingPostNotificationsCall = call
                pluginRequestPermissions(arrayOf(POST_NOTIFICATIONS), REQUEST_POST_NOTIFICATIONS)
            }
        } else {
            val result = JSObject()
            result.put("granted", true)
            call.resolve(result)
        }
    }
    override fun handleRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray
    ) {
        super.handleRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_POST_NOTIFICATIONS) {
            val pending = pendingPostNotificationsCall ?: return
            pendingPostNotificationsCall = null
            val granted = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
            val result = JSObject()
            result.put("granted", granted)
            pending.resolve(result)
        }
    }
    @PluginMethod
    fun openBatteryOptimizationSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = Uri.parse("package:${context.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
        call.resolve()
    }
    @PluginMethod
    fun isBatteryOptimizationExcluded(call: PluginCall) {
        val powerManager = context.getSystemService(PowerManager::class.java)
        val excluded = powerManager?.isIgnoringBatteryOptimizations(context.packageName) ?: false
        val result = JSObject()
        result.put("granted", excluded)
        call.resolve(result)
    }
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
                result.put("shown", false)
            }
        } else {
            result.put("shown", false)
        }
        call.resolve(result)
    }
    @PluginMethod
    fun startListening(call: PluginCall) {
        RevolutNotificationService.pluginInstance = this
        val intent = Intent(context, RevolutNotificationService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
        call.resolve()
    }
    @PluginMethod
    fun stopListening(call: PluginCall) {
        val intent = Intent(context, RevolutNotificationService::class.java)
        context.stopService(intent)
        call.resolve()
    }
    @PluginMethod
    fun getActiveNotifications(call: PluginCall) {
        val notifications = JSArray()
        val service = RevolutNotificationService.serviceInstance
        val active = service?.activeNotifications.orEmpty()
        for (sbn in active) {
            val extras = sbn.notification?.extras ?: continue
            val title = extras.getCharSequence(android.app.Notification.EXTRA_TITLE)?.toString() ?: ""
            val body = extras.getCharSequence(android.app.Notification.EXTRA_TEXT)?.toString() ?: ""
            val item = JSObject().apply {
                put("title", title)
                put("body", body)
                put("packageName", sbn.packageName)
                put("postedAt", RevolutNotificationService.formatPostedAt(sbn.postTime))
            }
            notifications.put(item)
        }
        val result = JSObject()
        result.put("notifications", notifications)
        call.resolve(result)
    }
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
