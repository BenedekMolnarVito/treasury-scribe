package com.treasuryscribe.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * SmokeTestReceiver
 *
 * Test-only entry point used by the `/smoke-test` skill to drive the
 * notification-capture pipeline on modern Android, where
 * `cmd notification post -p <pkg>` is no longer supported and shell-posted
 * notifications cannot impersonate `com.revolut.revolut`.
 *
 * Triggered by:
 *   adb shell am broadcast \
 *     -n com.treasuryscribe.app/.SmokeTestReceiver \
 *     -a com.treasuryscribe.app.SMOKE_TEST_INJECT \
 *     --ez treasuryScribeSmoke true \
 *     --es title "<title>" \
 *     --es body  "<body>"
 *
 * The receiver only forwards the synthetic event when both the action and
 * the `treasuryScribeSmoke=true` extra are present, so a stray external
 * broadcast cannot trigger this path. It is `exported="false"` in the
 * manifest, restricting senders to the same UID (= adb shell, which has
 * system-level reach on the device).
 */
class SmokeTestReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        if (!intent.getBooleanExtra(EXTRA_GUARD, false)) return

        val title = intent.getStringExtra("title") ?: ""
        val body = intent.getStringExtra("body") ?: ""

        val service = RevolutNotificationService.serviceInstance
        if (service != null) {
            service.injectSmokeTestNotification(title, body)
        } else {
            Log.w(
                TAG,
                "RevolutNotificationService not running — smoke event dropped"
            )
        }
    }

    companion object {
        const val ACTION = "com.treasuryscribe.app.SMOKE_TEST_INJECT"
        const val EXTRA_GUARD = "treasuryScribeSmoke"
        private const val TAG = "SmokeTestReceiver"
    }
}
