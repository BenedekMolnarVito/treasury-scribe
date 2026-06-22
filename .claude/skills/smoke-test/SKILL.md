---
name: smoke-test
description: Build, install, and autonomously smoke-test the Android app on a connected POCO / Xiaomi device — UI navigation via Mobile MCP plus the 3-second Revolut-capture SLA in foreground, background, and screen-off scenarios. Use when the user asks to smoke-test, verify the parsing branch, or confirm a fresh build catches notifications correctly.
allowed-tools: Bash, Read, Write, mcp__mobile-mcp__*
---

You are running an autonomous Android smoke test for `treasury-scribe`. The app
is a Capacitor (React-in-WebView) app whose core value is catching Revolut
notifications via `RevolutNotificationService` and persisting parsed
transactions within 3 seconds — even when the app is backgrounded or the
screen is off. Drive the device through **Mobile MCP**, never via raw `adb`
input commands when an MCP tool fits.

Work through the phases in order. Each phase has a **gate** — do not proceed
past it until the gate passes. If a phase fails, stop and report; do not
attempt the remaining phases (they will give meaningless results).

Write all artifacts (screenshots, the final report) under
`tests/smoke/screenshots/<ISO-timestamp>/`. Generate the timestamp once at
start (use `date -u +%Y%m%dT%H%M%SZ` via Bash) and reuse it.

---

## Phase 0 — Preflight

Run sequentially; abort on any failure with a one-line fix hint.

1. `adb version` — fail with "install with `brew install --cask android-platform-tools`".
2. `adb devices` — must list **exactly one** device in `device` state. If
   zero: "plug in the POCO and unlock the screen, then re-run". If multiple:
   "disconnect extras or set `ANDROID_SERIAL`".
3. `adb shell getprop ro.product.manufacturer` and `ro.product.model` — log
   both. Note in the report if manufacturer is `Xiaomi` (MIUI quirks apply).
4. `adb shell pm list packages | grep ^package:com.revolut.revolut$` — if
   missing, log a **warning** but continue (the listener filters by package
   name string, not by whether Revolut is installed).
5. `adb shell settings get secure enabled_notification_listeners` — log
   whether `com.treasuryscribe.app` appears in the result. **Do not abort if
   missing** — Phase 1.5 will re-grant it automatically after install (MIUI
   revokes Notification Listener access on every reinstall, even update-style).
   Just record the pre-install state for the report.

**Gate**: all of (1)–(4) pass. Notification Access state is noted but not
gating — auto-grant is in Phase 1.5.

---

## Phase 1 — Build + install

The critical race (per commit `dcd2ba0`): `./gradlew installDebug` returns
before the APK is actually installed. The reliable signal is `BUILD
SUCCESSFUL` followed by the package becoming queryable via `pm path`.

Execute:

1. `npm run android:run` via Bash with `timeout: 600000`. **Stream the
   output**; do not background it. The npm chain is
   `npm run build && npx cap sync android && ./android/gradlew -p ./android installDebug`.
2. Confirm the literal string `BUILD SUCCESSFUL` appears in the captured
   output. If it does not appear (only `BUILD FAILED` or no terminator):
   **abort** and surface the last 50 lines of gradle output.
3. After `BUILD SUCCESSFUL`, poll up to 30 times with 1s sleep between:
   `adb shell pm path com.treasuryscribe.app`
   until it prints a `package:/data/app/.../base.apk` line. Time how long
   the poll took and record `installSettleMs` for the report.

**Gate**: `pm path` resolves within 30s of `BUILD SUCCESSFUL`.

---

## Phase 1.5 — Re-grant permissions

MIUI / HyperOS revokes Notification Listener access on **every reinstall**,
including update-style installs. This phase fixes it automatically. The
device must have **"USB debugging (Security settings)"** enabled in Developer
Options (one-time toggle on the phone) for the auto-grant to succeed.

1. Run the helper:
   ```
   .claude/skills/smoke-test/lib/grant-permissions.sh
   ```
   It silently runs:
   - `cmd notification allow_listener com.treasuryscribe.app/com.treasuryscribe.app.RevolutNotificationService`
   - `pm grant com.treasuryscribe.app android.permission.POST_NOTIFICATIONS`
   - `dumpsys deviceidle whitelist +com.treasuryscribe.app`

   Then re-checks `enabled_notification_listeners`. Exit 0 = listener
   granted, 1 = still missing, 2 = adb / device problem.

2. **If the helper exits 0** → record `permissionGrant: auto` for the report
   and continue to Phase 2.

3. **If the helper exits 1** (the auto-grant didn't stick — usually means
   "USB debugging (Security settings)" is off on MIUI):
   - Deep-link the user to the exact settings page:
     ```
     adb shell am start -a android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS
     ```
   - Print to the user:
     > "Auto-grant failed. The phone just opened the Notification Access
     > screen — toggle **Treasury Scribe** on, then come back here. I'll
     > wait up to 2 minutes."
   - Poll every 2 seconds for up to 60 iterations:
     ```
     adb shell settings get secure enabled_notification_listeners | grep -q com.treasuryscribe.app
     ```
   - On match: record `permissionGrant: manual` and continue.
   - On timeout: **abort** with "Notification Access still not granted after
     120s. Enable it manually and re-run, or turn on 'USB debugging (Security
     settings)' in Developer Options to make this automatic."

4. **If the helper exits 2** → abort (adb/device issue, surface its stderr).

**Gate**: `enabled_notification_listeners` contains `com.treasuryscribe.app`.

---

## Phase 2 — UI smoke (Mobile MCP)

All UI interactions go through Mobile MCP tools — never `adb shell input tap`
unless an MCP tool genuinely cannot express the action.

1. `mcp__mobile-mcp__mobile_use_default_device` (or `mobile_list_available_devices`
   then `mobile_use_device` with the serial from Phase 0). Pick the
   `android` device.
2. `mcp__mobile-mcp__mobile_launch_app` with `packageName: com.treasuryscribe.app`.
3. Allow up to 8 seconds for the WebView splash. Poll
   `mcp__mobile-mcp__mobile_list_elements_on_screen` every 1s until you see
   a "Dashboard" / hero card element (text containing "Dashboard", or a
   currency total like "Ft" / "EUR"). If a permission/system dialog appears
   instead (Notification Access, POST_NOTIFICATIONS, MIUI AutoStart, battery
   optimization), **do not grant via the dialog** — these route to system
   Settings and granting needs user judgment. Instead:
   - For pure in-app dialogs: tap "Later" / "Skip" / dismiss.
   - For system Settings dialogs: `mobile_press_button` → `BACK`.
4. Take a screenshot of the Dashboard:
   `mcp__mobile-mcp__mobile_take_screenshot`, save as
   `tests/smoke/screenshots/<ts>/01-dashboard.png`.
5. Find the bottom-nav "Transactions" element via `list_elements_on_screen`
   and tap it. Wait for the transactions list to render.
6. Take a screenshot, save as `02-transactions.png`.
7. Tap "Dashboard" in the bottom nav, confirm we're back, take
   `03-back-to-dashboard.png`.

**Gate**: app launched, Dashboard rendered, Transactions reachable, three
screenshots saved.

---

## Phase 3 — Capture-SLA scenarios (the heart of the smoke)

Three scenarios, sequential. **Each scenario must use a distinct notification
body** because `src/App.tsx:324` de-duplicates by raw notification content —
reusing the same body silently drops the second post.

| Scenario     | App state                  | Body          | Distinct value? |
|--------------|----------------------------|---------------|-----------------|
| A foreground | Transactions tab open      | `6 337 Ft`    | yes             |
| B background | HOME pressed; app behind   | `1 599 Ft`    | yes             |
| C screen-off | screen turned off          | `€42,50`      | yes             |

For **each** scenario:

1. **Set up app state**:
   - **A**: navigate to Transactions via Mobile MCP if not already there.
   - **B**: `adb shell input keyevent KEYCODE_HOME`, then `sleep 1`. Confirm
     foreground app is the launcher via
     `adb shell dumpsys activity activities | grep mResumedActivity` — must
     not be `com.treasuryscribe.app`.
   - **C**: `adb shell input keyevent KEYCODE_POWER`, then `sleep 1`. Confirm
     screen is off via
     `adb shell dumpsys power | grep 'mWakefulness=' | head -1` — must show
     `Asleep` or `Dozing`.

2. **Start a logcat tail** (background Bash task, `run_in_background: true`):
   ```
   adb logcat -T 1 -v epoch chromium:I '*:S' > /tmp/treasury-smoke-<scenario>.log 2>&1
   ```
   `-T 1` starts from "now" (skip backlog). `chromium:I` filters to WebView
   console output where the existing `console.info("Captured Revolut
   notification", ...)` line from `src/App.tsx:313` lands. `*:S` silences
   everything else. Capture the returned task ID.

3. **Brief settle**: `sleep 0.5` so the logcat process is actively reading.

4. **Post the notification** using the helper:
   ```
   .claude/skills/smoke-test/lib/post-notification.sh <scenario> "<body>"
   ```
   The helper prints `T0` (epoch ms) on stdout — **capture this value**.

5. **Poll for the marker**, up to 5 seconds total (25 × 200ms):
   - `grep "Captured Revolut notification" /tmp/treasury-smoke-<scenario>.log`
   - On first match, extract the epoch timestamp at the start of the line
     (with `-v epoch`, each line begins with `<seconds>.<millis>`). Convert
     to integer ms → that's `T1`.
6. **Stop the logcat task** via TaskStop using the task ID.
7. **Compute `latencyMs = T1 - T0`**. Pass if `latencyMs ≤ 3000`. Record:
   - scenario name
   - latencyMs
   - pass / fail
   - the matched log line (truncated to 300 chars — should contain the
     `amount` and `currency` JSON fields)

After scenario C, wake the screen: `adb shell input keyevent KEYCODE_WAKEUP`
and `adb shell input keyevent 82` (menu) or swipe up to dismiss the lock
screen if needed.

8. **Final UI assertion**: bring the app forward
   (`mcp__mobile-mcp__mobile_launch_app` again — Capacitor brings the
   existing instance to front), navigate to Transactions, call
   `mobile_list_elements_on_screen`, and confirm the three amounts appear
   somewhere in the visible rows: `6 337`, `1 599`, `42,50` (or `42.50`
   depending on locale rendering). Screenshot as `04-post-sla.png`.

**Gate**: all three scenarios pass AND the post-SLA screenshot shows the new
transactions.

---

## Phase 4 — Report

Write a Markdown report to
`tests/smoke/screenshots/<ts>/REPORT.md` AND print it to the user.

Structure:

```markdown
# Smoke test — <ts>

## Device
- Manufacturer / model: …
- Android API: … (from `adb shell getprop ro.build.version.sdk`)
- Revolut installed: yes/no
- Notification Access pre-install: yes/no
- Permission grant: auto / manual / failed

## Phase 1 — build/install
- BUILD SUCCESSFUL: yes
- pm path settle: <installSettleMs> ms

## Phase 1.5 — permissions
- Auto-grant: ✓/✗
- Final Notification Access: ✓/✗
- POST_NOTIFICATIONS granted: ✓/✗ (Android 13+ only)
- Battery whitelist: ✓/✗

## Phase 2 — UI smoke
- Dashboard rendered: ✓
- Transactions reachable: ✓
- Screenshots: 01-dashboard.png, 02-transactions.png, 03-back-to-dashboard.png

## Phase 3 — capture SLA (target ≤ 3000 ms)
| Scenario      | Latency (ms) | Result |
|---------------|--------------|--------|
| A foreground  | …            | ✓/✗    |
| B background  | …            | ✓/✗    |
| C screen-off  | …            | ✓/✗    |

- Transactions visible after SLA pass: ✓/✗
- Screenshot: 04-post-sla.png

## Overall: PASS / FAIL
```

If overall FAIL, end your final assistant message with a concise diagnosis:
which phase failed, the most likely cause (notification access not granted /
foreground service killed / WebView not flushed / etc.), and the one command
the user should run next to dig deeper (e.g. `adb logcat -d -s chromium:I |
tail -100`).

---

## Implementation notes (for the agent running this skill)

- **MIUI revokes Notification Access on every reinstall** — even update-style
  installs from `installDebug`. Phase 1.5 re-grants automatically via adb.
  This requires the **"USB debugging (Security settings)"** toggle in
  Developer Options (a one-time phone-side setting, sibling of regular USB
  debugging). If a user reports that Phase 1.5's auto-grant keeps failing,
  the first thing to check is whether that toggle is on.
- **What auto-grant CANNOT fix on MIUI**: AutoStart and "Display pop-up
  windows in background" are locked behind Xiaomi's Security app and have no
  adb-grantable path. If background-capture scenarios (B and C) fail
  consistently while foreground passes, AutoStart is the prime suspect —
  surface this in the failure diagnosis.

- **Don't `adb shell input tap` for in-app UI** — use Mobile MCP. The only
  legitimate `adb input` calls are `keyevent KEYCODE_HOME`,
  `KEYCODE_POWER`, `KEYCODE_WAKEUP` (system-level, not app UI).
- **Dedup is by raw content** (`App.tsx:324`). The body strings in Phase 3
  are deliberately distinct. If you re-run the skill, the second run's
  scenario A will hit the dedup guard and time out — that's a re-run hazard,
  not a real failure. Mention it in the report when latency is exactly the
  5-second timeout. To force a clean re-run, uninstall and reinstall:
  `adb uninstall com.treasuryscribe.app` then rerun the skill.
- **`-v epoch` logcat format**: lines start with `1718901234.567 …`.
  Parse `seconds.milliseconds` and multiply: `(int(s) * 1000) + int(ms)`.
- **MIUI toast "Notification used in background"** on first post is
  harmless — log it, do not fail.
- **WebView tag** is `chromium`. If a future Capacitor upgrade changes this,
  the fallback is unfiltered `adb logcat | grep "Captured Revolut
  notification"` — only adopt if `chromium:I` returns nothing in scenario A.
- **`KEYCODE_POWER` toggles** — if the screen is already off when you press
  it, scenario C will run with the screen ON. Always check `mWakefulness`
  before posting.
- **The dedup guard logs `"Skipped duplicate Revolut notification"`
  (`App.tsx:324`)** — if you see this instead of the "Captured" line, the
  scenario body collided with a previous run. Treat as inconclusive, not
  fail, and suggest the uninstall-reinstall.
