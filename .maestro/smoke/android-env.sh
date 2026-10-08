# Treasury Scribe smoke-test Android env (macOS + Windows git-bash).
# Sourced by harness.py / cdp.py / fixtures/build_poster.sh. Override any var in your shell.

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    # Windows: keep an existing JAVA_HOME (JDK 21); SDK at the Android Studio default.
    export ANDROID_HOME="${ANDROID_HOME:-$(cygpath -u "${LOCALAPPDATA:-$HOME/AppData/Local}")/Android/Sdk}"
    export SMOKE_SCRATCH="${SMOKE_SCRATCH:-$(cygpath -u "${LOCALAPPDATA:-$HOME/AppData/Local}")/hermes/cache/scratch}"
    ;;
  *)
    export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
    export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
    export SMOKE_SCRATCH="${SMOKE_SCRATCH:-${TMPDIR:-/tmp}}"
    ;;
esac
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
# Idempotent PATH prepend: re-sourcing must not grow PATH. On Windows, cmd.exe (used by
# `npm run` scripts) ignores PATH beyond ~8191 chars, which makes vite/vitest "not recognized".
_ts_prepend() { case ":$PATH:" in *":$1:"*) ;; *) PATH="$1:$PATH" ;; esac; }
for _d in "$ANDROID_HOME/cmdline-tools/latest/bin" "$ANDROID_HOME/emulator" "$ANDROID_HOME/platform-tools" "$HOME/.maestro/bin"; do _ts_prepend "$_d"; done
[ -n "${JAVA_HOME:-}" ] && _ts_prepend "$JAVA_HOME/bin"
# Collapse any duplicates already accumulated in this shell.
PATH="$(printf '%s' "$PATH" | awk -v RS=: -v ORS=: '!seen[$0]++' | sed 's/:$//')"
export PATH; unset -f _ts_prepend; unset _d

# Never touch a physical phone: smoke tooling targets the emulator only.
export ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"

# TYPESAFE_API_KEY must be exported in your shell (e.g. ~/.zshrc); jev.py also
# falls back to sourcing ~/.zshrc. Never commit the key.
