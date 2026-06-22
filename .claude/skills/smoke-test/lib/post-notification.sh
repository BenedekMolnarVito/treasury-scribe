#!/usr/bin/env bash
# post-notification.sh
#
# Inject a synthetic Revolut notification onto the connected Android device so
# the /smoke-test skill can verify the capture-SLA path end to end.
#
# Posts under package "com.revolut.revolut" so RevolutNotificationService.kt's
# filter at line 97 (`if (sbn.packageName != REVOLUT_PACKAGE) return`) accepts
# it. The system permits cross-package posts via `cmd notification post` as
# long as adb shell has the SHELL UID, which it always does.
#
# Usage:
#   post-notification.sh <scenario-tag> <body>
#
# Example:
#   post-notification.sh foreground "6 337 Ft"
#
# Prints (to stdout) the epoch-millisecond timestamp of the post — captured
# by the skill as T0 for latency math.

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <scenario-tag> <body>" >&2
  exit 2
fi

scenario="$1"
body="$2"

if ! command -v adb >/dev/null 2>&1; then
  echo "adb not found on PATH" >&2
  exit 3
fi

devices=$(adb devices | awk 'NR>1 && $2=="device" {print $1}')
device_count=$(printf '%s\n' "$devices" | grep -c . || true)
if [[ "$device_count" -ne 1 ]]; then
  echo "expected exactly one connected device, got $device_count" >&2
  adb devices >&2
  exit 4
fi

# T0: epoch ms captured immediately BEFORE the post call.
# Print first so the caller can read T0 before adb returns (and the consumer
# can race the logcat tail without missing the T1 line).
t0=$(date +%s%3N)
echo "$t0"

# `cmd notification post`:
#   -p <pkg>   pretend the notification came from this package
#   -t <tag>   notification tag (must be unique to allow re-posting)
#   <title>    positional: notification title
#   <text>     positional: notification body
#
# We pack a scenario-stamped title so logcat / dumpsys traces stay readable,
# and put the parseable amount text in the body (which is what
# RevolutNotificationService reads via EXTRA_TEXT — see the .kt at line ~103).
adb shell cmd notification post \
  -p com.revolut.revolut \
  -t "smoke-${scenario}-${t0}" \
  "TreasuryScribeSmoke ${scenario}" \
  "${body}" >/dev/null
