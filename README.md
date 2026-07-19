# APK Compat Helper

一个面向普通用户的本地桌面工具, 用于扫描旧 APK、展示 Android 兼容风险、调整 targetSDK, 并重新构建、对齐和签名 APK.

[English README](README_EN.md)

## 下载

从 [GitHub Releases](https://github.com/rianlu/apk-compat-helper/releases) 下载 macOS DMG 或 Windows 便携版 ZIP.

## 功能

- 拖入或选择单个 APK, 文件仅在本机处理.
- 读取 Manifest、targetSDK、权限、DEX、原生库和明文 HTTP 特征.
- 默认使用配置文件中的最新 Android API, 当前为 API 36 / Android 16.
- 显示修改前后 targetSDK 和 Android 版本.
- 列出实验性风险、Manifest 真实权限名及中英文用途说明.
- 允许用户在存在风险时继续处理.
- 修改 targetSDK、主入口 `android:exported` 和可选明文 HTTP 设置.
- 使用 apktool 重建, 再执行 ZIP 对齐、重新签名和验证.
- 显示实时处理进度, 输出目录默认位于原 APK 目录.
- 通过内置 ADB 刷新设备并安装输出 APK.
- 支持中文、英文以及浅色、深色、跟随系统主题.

## 使用边界

- 本工具执行静态特征检查, 不能证明 APK 已完整适配新 Android 版本.
- 当前主动修改 `AndroidManifest.xml` 和 apktool 元数据, 但重建过程会完整解包和重新打包 APK.
- 输出 APK 使用本地生成的证书重新签名. 如果设备上已安装原签名版本, 通常需要先卸载原应用才能安装.
- 动态权限判断通过搜索常见申请特征完成, 反射、混淆、第三方框架或原生代码可能无法识别.
- 尚未完整覆盖分区存储、后台定位、前台服务类型及 Android 12至16的全部行为变更.
- 不包含 macOS 公证和自动检查更新.

## 支持平台

| 平台 | 支持基线 | 构建产物 |
| --- | --- | --- |
| macOS | macOS 12及以上, Apple Silicon | `.app`, `.dmg` |
| Windows | Windows 10 21H2及以上, x64 | 便携版 `.zip`, 解压后直接运行 |

项目采用 Tauri 2、React 和 Rust. GitHub Actions 会分别在 macOS 和 Windows 环境构建对应安装包.

工具资源分为:

- `resources/tooling/common`: 跨平台共用的 apktool 和 apksigner JAR.
- `resources/tooling/macos`: macOS 原生工具和精简 Java Runtime.
- `resources/tooling/windows`: Windows 原生工具、ADB DLL 和精简 Java Runtime, 在 Windows 构建时生成.

## 开发

要求 Node.js 20及以上和 Rust stable.

```zsh
npm install
npm run tauri dev
```

验证:

```zsh
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
APK_COMPAT_TOOLS_DIR="$PWD/src-tauri/resources/tooling/macos" cargo test --manifest-path src-tauri/Cargo.toml
```

构建 macOS 安装包:

```zsh
npm run tauri build
```

首次在 Windows 构建前, 安装 JDK 17和 Android SDK Build Tools / Platform Tools, 配置 `JAVA_HOME` 与 `ANDROID_SDK_ROOT`. `npm run tauri build` 会自动准备 Windows 内置工具:

```powershell
npm install
npm run tauri build
```

产物位于 `src-tauri/target/release/bundle/`.

Android 版本和权限说明统一维护在 [`src-tauri/resources/compatibility-catalog.json`](src-tauri/resources/compatibility-catalog.json).
