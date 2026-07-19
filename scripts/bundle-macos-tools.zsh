#!/bin/zsh
set -euo pipefail

root=${0:A:h:h}
output="$root/src-tauri/resources/tooling/macos"
common="$root/src-tauri/resources/tooling/common"
sdk=${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}
build_tools=$(find "$sdk/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)
apktool_jar=$( { find /opt/homebrew/Cellar/apktool /usr/local/Cellar/apktool -name 'apktool_*.jar' 2>/dev/null || true; } | sort -V | tail -1)
java_home=${JAVA_HOME:-$(/usr/libexec/java_home -v 17)}

test -n "$build_tools"
test -n "$apktool_jar"
test -x "$java_home/bin/jlink"

mkdir -p "$output" "$common"
if [[ ! -x "$output/runtime/bin/java" ]]; then
  "$java_home/bin/jlink" \
    --add-modules java.base,java.desktop,java.logging,jdk.crypto.ec \
    --strip-debug \
    --no-man-pages \
    --no-header-files \
    --compress=2 \
    --output "$output/runtime"
fi
cp "$java_home/bin/keytool" "$output/runtime/bin/keytool"
cp "$apktool_jar" "$common/apktool.jar"
test -f "$common/apktool2.jar"
cp "$build_tools/aapt" "$output/aapt"
cp "$build_tools/aapt2" "$output/aapt2"
cp "$build_tools/zipalign" "$output/zipalign"
cp "$build_tools/lib/apksigner.jar" "$common/apksigner.jar"
cp "$sdk/platform-tools/adb" "$output/adb"
chmod +x "$output/runtime/bin/java" "$output/runtime/bin/keytool" "$output/aapt" "$output/aapt2" "$output/zipalign" "$output/adb"

"$output/runtime/bin/java" -version
"$output/runtime/bin/keytool" -help >/dev/null
"$output/runtime/bin/java" -jar "$common/apktool.jar" --version
"$output/runtime/bin/java" -jar "$common/apktool2.jar" --version
"$output/runtime/bin/java" -jar "$common/apksigner.jar" version
"$output/aapt" version
"$output/aapt2" version
"$output/zipalign" -h >/dev/null 2>&1 || true
"$output/adb" version
