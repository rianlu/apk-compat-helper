# APK Compat Helper

Local desktop utility for scanning legacy APKs, explaining Android compatibility risks, changing targetSDK, and rebuilding, aligning, and signing the result.

[中文文档](README.md)

## Download

Download the macOS DMG or Windows EXE installer from [GitHub Releases](https://github.com/rianlu/apk-compat-helper/releases).

## Features

- Drop or choose one APK. Files stay on the local computer.
- Inspect the manifest, targetSDK, permissions, DEX files, native libraries, and cleartext HTTP indicators.
- Default to the latest Android API in the compatibility catalog, currently API 36 / Android 16.
- Compare targetSDK and Android versions before and after repair.
- Show experimental findings with real manifest permission names and bilingual descriptions.
- Allow users to continue even when compatibility risks are present.
- Update targetSDK, launcher `android:exported`, and optional cleartext HTTP settings.
- Rebuild with apktool, then align, re-sign, and verify the APK.
- Show live progress and save next to the source APK by default.
- Refresh connected devices and install the output through the bundled ADB.
- Support Chinese, English, light, dark, and system themes.

## Limitations

- Static indicators cannot prove that an APK fully supports a newer Android release.
- The tool directly changes `AndroidManifest.xml` and apktool metadata, but apktool fully decodes and rebuilds the package.
- The output is signed with a locally generated certificate. If the original signed app is installed, it usually must be removed before installing the rebuilt APK.
- Runtime permission detection searches for common request patterns. Reflection, obfuscation, third-party frameworks, and native code may not be detected.
- Scoped storage, background location, foreground service types, and every Android 12-16 behavior change are not fully covered yet.
- macOS notarization and automatic update checks are not included.

## Platforms

| Platform | Baseline | Artifact |
| --- | --- | --- |
| macOS | macOS 12+, Apple Silicon | `.app`, `.dmg` |
| Windows | Windows 10 21H2+, x64 | `.exe` NSIS installer |

The project uses Tauri 2, React, and Rust. GitHub Actions builds each installer on its target operating system.

Tool resources are separated into:

- `resources/tooling/common`: cross-platform apktool and apksigner JAR files.
- `resources/tooling/macos`: native macOS tools and a minimized Java runtime.
- `resources/tooling/windows`: native Windows tools, ADB DLL files, and a minimized Java runtime generated on Windows.

## Development

Node.js 20+ and stable Rust are required.

```zsh
npm install
npm run tauri dev
```

Validation:

```zsh
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
APK_COMPAT_TOOLS_DIR="$PWD/src-tauri/resources/tooling/macos" cargo test --manifest-path src-tauri/Cargo.toml
```

Build the macOS package:

```zsh
npm run tauri build
```

Before the first Windows build, install JDK 17 and Android SDK Build Tools / Platform Tools, then configure `JAVA_HOME` and `ANDROID_SDK_ROOT`. `npm run tauri build` prepares the bundled Windows tools automatically:

```powershell
npm install
npm run tauri build
```

Artifacts are generated under `src-tauri/target/release/bundle/`.

Android versions and permission descriptions are maintained in [`src-tauri/resources/compatibility-catalog.json`](src-tauri/resources/compatibility-catalog.json).
