#!/usr/bin/env bash
# post-notification.sh — drive the smoke-test capture pipeline by broadcasting
# a synthetic Revolut notification into SmokeTestReceiver, which forwards it
# to RevolutNotificationService.injectSmokeTestNotification(). Bypasses the
# `cmd notification post -p` shell limitation on modern Android (≥14), which
# no longer lets shell-posted notifications impersonate `com.revolut.revolut`.
#
# Usage:  post-notification.sh <scenario-tag> <body>

set -euo pipefail

[[ $# -eq 2 ]] || { echo "usage: $0 <scenario-tag> <body>" >&2; exit 2; }

scenario="$1"; body="$2"
command -v adb >/dev/null 2>&1 || { echo "adb missing on PATH" >&2; exit 3; }

# T0: epoch ms captured BEFORE the inject. macOS BSD `date` lacks %N, so use
# python3 for millisecond precision.
t0=$(python3 -c 'import time; print(int(time.time()*1000))')
echo "$t0"

# `adb shell am broadcast` runs the args through the device-side shell, which
# re-tokenizes on whitespace. Bodies like "6 337 Ft" would split into three
# separate args and only "6" would land in --es body. Wrap each value with
# single quotes (escaping any embedded single quotes the standard sh-safe
# way) so the device shell preserves the value as one token.
sh_quote() {
  printf "'%s'" "${1//\'/\'\\\'\'}"
}

adb shell am broadcast \
  -n com.treasuryscribe.app/.SmokeTestReceiver \
  -a com.treasuryscribe.app.SMOKE_TEST_INJECT \
  --ez treasuryScribeSmoke true \
  --es title "$(sh_quote "Smoke-${scenario}")" \
  --es body  "$(sh_quote "${body}")" >/dev/null
