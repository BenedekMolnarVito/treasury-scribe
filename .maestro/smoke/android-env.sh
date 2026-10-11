# Treasury Scribe smoke-test Android env.
# Sourced by harness.py / cdp.py for adb + gradle. Override any var in your shell.
# Paths resolve to common SDK locations; set them explicitly if yours differ.

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export PATH="$JAVA_HOME/bin:$HOME/.maestro/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

# TYPESAFE_API_KEY must be exported in your shell (e.g. ~/.zshrc); jev.py also
# falls back to sourcing ~/.zshrc. Never commit the key.
