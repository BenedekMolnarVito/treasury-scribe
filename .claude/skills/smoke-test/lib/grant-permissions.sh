#!/usr/bin/env bash
# grant-permissions.sh
#
# After every (re)install of com.treasuryscribe.app, MIUI / HyperOS revokes
# Notification Listener access and runtime permissions — even for update-style
# installs (`installDebug` over an existing APK). This script silently re-grants
# everything that adb is allowed to grant on a MIUI device with
# "USB debugging (Security settings)" enabled.
#
# Idempotent: safe to run before every smoke test, on a fresh install, on an
# already-permitted install, even when the app isn't installed (it'll fail
# loudly in that case).
#
# Exit codes:
#   0  Notification Listener is granted (the only one the SLA scenarios truly
#      depend on). Battery whitelist / POST_NOTIFICATIONS are best-effort.
#   1  Notification Listener still missing after all grant attempts. Caller
#      should fall back to deep-linking the user to Settings and polling.
#   2  adb missing or no device connected.
#
# What this CANNOT grant on MIUI (no adb path exists — manual only):
#   - AutoStart (Xiaomi Security app, proprietary)
#   - Lock-screen widget access
#   - "Display pop-up windows while running in background"

set -uo pipefail

APP_PKG="com.treasuryscribe.app"
LISTENER="${APP_PKG}/${APP_PKG}.RevolutNotificationService"

log() { printf '[grant] %s\n' "$*" >&2; }

if ! command -v adb >/dev/null 2>&1; then
  log "adb not found on PATH"
  exit 2
fi

device_count=$(adb devices | awk 'NR>1 && $2=="device" {print $1}' | grep -c . || true)
if [[ "$device_count" -ne 1 ]]; then
  log "expected exactly one connected device, got $device_count"
  exit 2
fi

# Confirm the package is actually installed before attempting grants — otherwise
# adb will print scary errors that look worse than the actual situation.
if ! adb shell pm path "$APP_PKG" >/dev/null 2>&1; then
  log "$APP_PKG not installed on device — nothing to grant"
  exit 1
fi

# 1) Notification Listener — the one the SLA depends on.
#    `cmd notification allow_listener` is the cleanest API and works on MIUI
#    when "USB debugging (Security settings)" is enabled.
log "granting Notification Listener access"
adb shell cmd notification allow_listener "$LISTENER" >/dev/null 2>&1 || true

# 2) POST_NOTIFICATIONS — runtime permission, Android 13+. Older devices will
#    no-op with "Operation not allowed", which is fine.
log "granting POST_NOTIFICATIONS"
adb shell pm grant "$APP_PKG" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1 || true

# 3) Battery optimization whitelist — keeps the foreground service alive so the
#    listener still fires when the screen is off (Phase 3 scenario C).
log "adding battery-optimization whitelist"
adb shell dumpsys deviceidle whitelist "+$APP_PKG" >/dev/null 2>&1 || true

# 4) Verify the only one that matters: did the Notification Listener stick?
#    `settings get secure enabled_notification_listeners` returns a
#    colon-separated list. Match on the package — Kotlin may mangle the
#    component class differently across MIUI versions.
enabled=$(adb shell settings get secure enabled_notification_listeners 2>/dev/null || true)
if printf '%s' "$enabled" | grep -q "$APP_PKG"; then
  log "Notification Listener confirmed granted ✓"
  exit 0
fi

log "Notification Listener NOT granted after auto-grant attempts"
log "enabled_notification_listeners returned: ${enabled:-<empty>}"
exit 1
