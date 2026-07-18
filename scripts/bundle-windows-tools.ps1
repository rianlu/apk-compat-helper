$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root "src-tauri/resources/tooling/windows"
$common = Join-Path $root "src-tauri/resources/tooling/common"
$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { throw "ANDROID_SDK_ROOT is required" }
$javaHome = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { throw "JAVA_HOME is required" }
$buildTools = Get-ChildItem (Join-Path $sdk "build-tools") -Directory | Sort-Object { [version]$_.Name } | Select-Object -Last 1

if (-not $buildTools) { throw "Android SDK Build Tools were not found" }
if (-not (Test-Path (Join-Path $common "apktool.jar"))) { throw "resources/tooling/common/apktool.jar is missing" }

New-Item -ItemType Directory -Force $output, $common | Out-Null
$runtime = Join-Path $output "runtime"
if (-not (Test-Path (Join-Path $runtime "bin/java.exe"))) {
  & (Join-Path $javaHome "bin/jlink.exe") `
    --add-modules java.base,java.desktop,java.logging,jdk.crypto.ec `
    --strip-debug `
    --no-man-pages `
    --no-header-files `
    --compress=2 `
    --output $runtime
}

Copy-Item (Join-Path $javaHome "bin/keytool.exe") (Join-Path $runtime "bin/keytool.exe")
Copy-Item (Join-Path $buildTools.FullName "aapt2.exe") $output
Copy-Item (Join-Path $buildTools.FullName "zipalign.exe") $output
Copy-Item (Join-Path $buildTools.FullName "lib/apksigner.jar") (Join-Path $common "apksigner.jar")
Copy-Item (Join-Path $sdk "platform-tools/adb.exe") $output
Copy-Item (Join-Path $sdk "platform-tools/AdbWinApi.dll") $output
Copy-Item (Join-Path $sdk "platform-tools/AdbWinUsbApi.dll") $output

& (Join-Path $runtime "bin/java.exe") -jar (Join-Path $common "apktool.jar") --version
& (Join-Path $runtime "bin/java.exe") -jar (Join-Path $common "apksigner.jar") version
& (Join-Path $output "aapt2.exe") version
& (Join-Path $output "adb.exe") version
