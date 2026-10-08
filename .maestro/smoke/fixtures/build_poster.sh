#!/usr/bin/env bash
# Build + install the SMOKE-ONLY fake notification posters onto the isolated emulator.
#   com.revolut.revolut            (allow-listed source; NEVER install on a real phone)
#   com.treasury.smokeposter.other (NG13 non-Revolut package)
# Source lives in-repo (.maestro/smoke/fixtures/poster); builds happen in a scratch copy so
# no build outputs or binaries land in git. Gradle wrapper jar is NOT committed: supply
# POSTER_WRAPPER_FROM=<dir containing gradlew + gradle/wrapper/gradle-wrapper.jar>, or have
# `gradle` on PATH (we then run `gradle wrapper --gradle-version 8.14.3`).
#
# Usage (git-bash):  bash .maestro/smoke/fixtures/build_poster.sh [--no-install]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../android-env.sh"
SERIAL="${ANDROID_SERIAL:-emulator-5554}"
[ "$SERIAL" = "emulator-5554" ] || { echo "REFUSE: serial $SERIAL is not emulator-5554" >&2; exit 2; }
SCRATCH="${POSTER_BUILD_DIR:-$SMOKE_SCRATCH/ts-smoke-poster}"
# Any Gradle wrapper works; default borrows the app's own android/ wrapper.
WRAP="${POSTER_WRAPPER_FROM:-$HERE/../../../android}"
INSTALL=1; [ "${1:-}" = "--no-install" ] && INSTALL=0

rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"
cp -r "$HERE/poster/." "$SCRATCH/"
if [ -f "$WRAP/gradle/wrapper/gradle-wrapper.jar" ]; then
  cp "$WRAP/gradlew" "$WRAP/gradlew.bat" "$SCRATCH/" 2>/dev/null || cp "$WRAP/gradlew" "$SCRATCH/"
  cp "$WRAP/gradle/wrapper/gradle-wrapper.jar" "$SCRATCH/gradle/wrapper/"
elif command -v gradle >/dev/null; then
  (cd "$SCRATCH" && gradle wrapper --gradle-version 8.14.3)
else
  echo "ERROR: no gradle wrapper source ($WRAP) and no gradle on PATH" >&2; exit 3
fi
SDK_NATIVE="$(cygpath -m "$ANDROID_HOME" 2>/dev/null || echo "$ANDROID_HOME")"
echo "sdk.dir=$SDK_NATIVE" > "$SCRATCH/local.properties"

build() { # $1 appId  $2 output apk name
  (cd "$SCRATCH" && ./gradlew -q --no-daemon -PposterAppId="$1" clean assembleDebug)
  cp "$SCRATCH/app/build/outputs/apk/debug/app-debug.apk" "$SCRATCH/$2"
  sha256sum "$SCRATCH/$2"
}
build com.revolut.revolut poster-revolut.apk
build com.treasury.smokeposter.other poster-other.apk

if [ "$INSTALL" = 1 ]; then
  for pair in "com.revolut.revolut:poster-revolut.apk" "com.treasury.smokeposter.other:poster-other.apk"; do
    pkg="${pair%%:*}"; apk="${pair##*:}"
    adb -s "$SERIAL" install -r -t "$(cygpath -m "$SCRATCH/$apk" 2>/dev/null || echo "$SCRATCH/$apk")"
    adb -s "$SERIAL" shell pm grant "$pkg" android.permission.POST_NOTIFICATIONS || true
    adb -s "$SERIAL" shell pm path "$pkg"
  done
fi
echo "POSTER_BUILD_OK dir=$SCRATCH"
