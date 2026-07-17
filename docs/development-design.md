# APK Compat Helper 开发设计文档

## 1. 文档信息

| 项目 | 内容 |
|---|---|
| 文档状态 | 初始设计基线 |
| 文档版本 | 0.1.0 |
| 更新日期 | 2026-07-16 |
| 当前目录名 | `app-compact-helper` |
| 建议仓库名 | `apk-compat-helper` |
| 建议产品名 | APK Compat Helper |
| 产品类型 | 本地离线桌面工具 |

## 2. 产品结论

将产品定位为旧 Android APK 兼容性检测与轻量修复工具. 优先处理主题, 图标包, 壁纸包等资源型 APK, 有条件处理不包含原生库的简单离线游戏.

不要将产品定位为通用 APK 现代化工具, 通用反编译器或万能游戏修复器. 首版只自动执行可以静态判断, 可以稳定复现, 可以验证结果的修改.

产品核心价值:

1. 判断 APK 为什么无法在目标 Android 设备上安装或运行.
2. 区分推荐适配, 风险适配, 实验性适配和禁止处理的问题.
3. 自动完成 Manifest 修改, 重建, 对齐和签名.
4. 通过 ADB 完成安装验证, 启动验证和日志采集.
5. 输出原 APK, 修改项, 风险和验证结果的完整报告.

## 3. 产品边界

### 3.1 首版支持对象

- 启动器主题 APK.
- 图标包 APK.
- 静态壁纸包 APK.
- 主要由 `res/`, `assets/`, XML 和图片组成的资源型 APK.
- 不包含 `lib/*.so` 的简单离线应用或小游戏.
- 单一 APK 文件, 不依赖 Split APK, OBB 或额外数据包.
- 未加固, 未混淆到阻止资源重建的 APK.
- 用户有权修改和使用的 APK.

### 3.2 首版不建议适配对象

- Unity, Cocos, Unreal 等包含大量原生库的游戏.
- 只有 32 位原生库且目标设备只支持 64 位应用的 APK.
- 存在 16 KB page size 原生库兼容问题的 APK.
- XAPK, APKS, AAB, Split APK 和 OBB 数据包.
- 加固, DRM, 付费验证, 在线授权或反篡改应用.
- 依赖原开发者签名, `signature` 权限或 `sharedUserId` 的应用.
- 依赖已经删除的启动器主题协议或系统私有 API 的插件.
- 依赖停止运营服务器的应用.
- 需要大范围 Smali 业务逻辑重写的应用.

以上对象仍允许完成安全扫描并输出报告. 除命中硬阻断条件外, 用户确认风险后可以继续选择 targetSdk 和允许的 Manifest 修改, 但结果必须标记为实验性适配, 不得宣称兼容成功.

只有以下情况硬阻断后续修改:

- APK 损坏, ZIP 路径穿越, ZIP Bomb 或资源消耗超过安全上限.
- 输入不是可独立重建的完整 APK, 例如仅提供 Split APK 的单个片段.
- 后续操作需要绕过 DRM, 付费验证, 反篡改或其他保护机制.
- 用户无权修改或使用该 APK.

### 3.3 适配等级

扫描完成后只返回以下一种等级:

| 等级 | 含义 | 产品行为 |
|---|---|---|
| 推荐适配 | 问题匹配高确定性规则 | 允许直接适配 |
| 风险适配 | 可以重建, 但运行结果依赖权限, 宿主或设备 | 展示风险, 用户确认后适配 |
| 实验性适配 | 静态分析发现代码级或平台级高风险 | 默认不推荐, 用户明确确认后仍允许继续 |
| 禁止处理 | 命中输入安全, 输入完整性, 权利或保护机制边界 | 停止修改, 仅输出允许生成的报告和原因 |

禁止在无法判断时返回推荐适配. 兼容性风险只影响建议等级, 不直接禁止用户继续; 硬阻断条件除外.

## 4. 用户场景

### 4.1 主题 APK 修复

1. 用户拖入旧主题 APK.
2. 工具识别包名, SDK, 资源结构, 启动器协议和宿主依赖.
3. 工具判断 APK 是否属于资源型主题包.
4. 工具应用允许的 Manifest 修复.
5. 工具重新构建并签名 APK.
6. 用户连接 Android 设备.
7. 工具安装 APK并检查目标启动器能否识别主题.
8. 工具输出修复报告和新 APK.

### 4.2 离线小游戏检查

1. 用户拖入游戏 APK.
2. 工具检查 `lib/`, DEX 数量, 资源体积, 网络权限, 数据包依赖和签名风险.
3. 如果存在原生库或代码级兼容风险, 工具返回实验性适配并展示证据.
4. 如果存在加固, 额外数据包或不完整输入, 工具根据硬阻断条件决定是否允许继续.
5. 用户确认实验性风险后可以继续执行所选 Manifest 修改和安装验证.
6. 工具采集启动崩溃日志并给出结果.

### 4.3 仅扫描

1. 用户拖入 APK.
2. 工具只执行静态检测.
3. 工具不解包修改, 不生成签名, 不连接设备.
4. 工具输出 JSON 和 Markdown 报告.

## 5. 功能需求

### 5.1 环境检查

应用必须将运行所需依赖打包在安装包内. 用户不得额外安装 Python, Java, Android SDK 或配置环境变量.

应用启动时检查以下内置组件:

- 精简 Java Runtime.
- `apktool`.
- Android SDK Build Tools 中的 `aapt2`, `apksigner` 和 `zipalign`.
- Android Platform Tools 中的 `adb`.

环境检查必须校验组件路径, 版本和 SHA-256. 内置组件损坏时显示重新安装提示; 不要求用户自行配置外部工具. 缺少修复组件时仍允许执行不依赖该组件的只读扫描.

### 5.2 APK 输入校验

执行以下检查:

- 文件存在且扩展名为 `.apk`.
- 文件头和 ZIP 中央目录有效.
- 文件大小未超过可配置上限.
- ZIP 条目数量和解压后预计体积未超过安全上限.
- ZIP 条目路径不存在目录穿越.
- 文件 SHA-256 已计算并写入任务记录.
- 原始文件只读处理, 不在原路径覆盖.

### 5.3 静态扫描

提取以下信息:

- 应用名称.
- 包名.
- `versionCode` 和 `versionName`.
- `minSdkVersion` 和 `targetSdkVersion`.
- 主 Activity.
- Activity, Service, Receiver 和 Provider.
- `intent-filter` 和 `android:exported`.
- 权限列表.
- 硬件和软件 Feature.
- 签名版本和证书摘要.
- DEX 文件数量.
- 原生库 ABI 和文件列表.
- `assets/` 和资源目录概况.
- 是否包含已知游戏引擎特征.
- 是否存在 Split APK 或 OBB 依赖特征.
- 是否声明宿主启动器包名, 主题 Intent 或图标包协议.
- 是否存在 HTTP 明文网络迹象.
- 是否存在 `sharedUserId` 或签名权限.
- 是否声明 Android 危险权限.
- DEX 中是否存在 `requestPermissions`, `checkSelfPermission`, Activity Result API 或常见权限框架调用迹象.
- 是否存在后台 Service, 外部存储, File URI, 通知, 前台服务和查询其他应用等跨 targetSdk 行为风险.

### 5.4 APK 类型识别

首版只使用明确规则分类, 不引入机器学习.

分类顺序:

1. 检测原生游戏引擎和原生库.
2. 检测图标包和主题协议特征.
3. 检测壁纸 Service 和相关资源.
4. 检测普通可启动应用.
5. 无法确定时标记为未知 APK.

分类结果:

- 主题包.
- 图标包.
- 壁纸包.
- 简单离线应用或游戏.
- 原生游戏.
- 未知 APK.

### 5.5 修复规则

每条规则必须满足以下条件:

- 包含唯一规则 ID.
- 声明检测条件.
- 声明修改内容.
- 声明风险等级.
- 声明适用 Android 版本.
- 声明验证方式.
- 修改前后可以生成差异记录.
- 同一输入和配置产生一致结果.

首版规则:

#### R001: 低 targetSdk 安装兼容

- 检测目标设备 Android 版本和系统安装限制.
- 同时显示 targetSdk API Level 和对应 Android 版本.
- 允许用户自行选择 targetSdk, 默认推荐目标设备允许安装的最低值.
- 禁止默认提高到最新 targetSdk.
- 用户修改 targetSdk 后立即重新计算跨版本行为风险和适配等级.
- 提醒 targetSdk 表示应用采用的系统行为规则, 不等于应用可以运行的最高 Android 版本.

#### R002: 组件导出声明

- 检查包含 `intent-filter` 的组件.
- 仅在目标 targetSdk 要求且语义明确时补充 `android:exported`.
- 主启动 Activity 设置为 `true`.
- 无外部调用证据的内部组件设置为 `false`.
- 无法判断的组件保持不变并标记风险, 不阻止用户继续其他修改.

#### R003: 明文 HTTP 配置

- 检测 `http://` 字符串和网络权限.
- 仅在确认旧应用依赖 HTTP 时允许设置 `usesCleartextTraffic`.
- 将该修改标记为安全风险.
- 不在扫描阶段主动访问任何 URL.

#### R004: APK 对齐和现代签名

- 使用 `zipalign` 对齐重建产物.
- 使用 `apksigner` 生成兼容签名.
- 验证签名和对齐结果.
- 保留原证书摘要, 新证书摘要和签名变更警告.

#### R005: 主题宿主依赖报告

- 提取已知启动器包名和 Intent.
- 检查连接设备是否安装对应宿主.
- 宿主缺失时不宣称修复成功.
- 宿主存在但协议未知时标记为风险适配.

### 5.6 targetSdk 可行性评估

targetSdk 调整前后至少检查以下行为边界:

| API 边界 | Android 版本 | 主要风险 | 首版行为 |
|---|---|---|---|
| 23 | Android 6.0 | 运行时危险权限 | 有危险权限但未发现权限申请流程时标记为实验性适配 |
| 24 | Android 7.0 | File URI 限制 | 检测 FileProvider 和文件 URI 使用迹象 |
| 26 | Android 8.0 | 后台执行限制和通知渠道 | 存在后台 Service 时标记风险 |
| 28 | Android 9 | 明文 HTTP 默认限制 | 检测网络权限和 `http://` 迹象 |
| 29 | Android 10 | 分区存储 | 检测外部存储权限和文件路径调用迹象 |
| 30 | Android 11 | 包可见性限制 | 检测查询其他应用行为迹象 |
| 31 | Android 12 | exported 和 PendingIntent 可变性 | 仅自动修改语义明确的 Manifest 项 |
| 33 | Android 13 | 通知运行时权限 | 使用通知但未发现权限申请流程时标记风险 |
| 34 | Android 14 | 前台服务类型等限制 | 存在前台 Service 时标记风险或实验性适配 |

动态权限不得仅凭权限声明直接判定不可适配. 当原 targetSdk 小于 23, 新 targetSdk 大于等于 23, APK 声明危险权限且未发现运行时权限申请流程时, 标记为实验性适配. 用户确认相关权限可能不在实际使用路径中后仍可继续修改.

静态分析只能提供代码调用迹象, 不能证明所有运行路径. 混淆, 反射和动态加载存在时必须降低结论确定性.

首版不自动执行以下修改:

- 包名替换.
- Provider Authority 批量替换.
- Smali 控制流修改.
- 权限删除.
- 存储模型迁移.
- 原生库修改.
- 资源 ID 重排修复.

## 6. 技术方案

### 6.1 技术栈

采用以下单一方案:

- Tauri 2 构建跨平台桌面应用.
- React 和 TypeScript 构建 UI.
- Vite 构建前端资源.
- CSS Modules 和 CSS Variables 实现样式和主题.
- Rust 实现 APK 校验, 扫描, 规则执行, 任务编排和外部工具调用.
- `serde` 处理前后端结构化数据和 JSON 报告.
- `tokio` 执行可取消的异步任务.
- `zip`, `quick-xml`, `sha2` 和 `tempfile` 处理 ZIP, XML, 哈希和临时目录.
- `tracing` 记录结构化日志.
- Rust `keyring` crate 保存本地签名密码到系统凭据存储.
- Cargo test 和 Vitest 分别验证 Rust 核心逻辑和前端状态展示.
- Tauri Bundler 构建 macOS 和 Windows 安装包.

不引入 Python 运行时, Web 后端, 数据库服务, Electron, Redux, 插件系统或远程 API.

### 6.2 架构

```text
React UI
    |
Tauri Command Boundary
    |
Rust Application Core
    |
    +-- APK Scanner
    +-- Compatibility Classifier
    +-- Repair Rule Runner
    +-- Build And Sign Pipeline
    +-- ADB Validator
    +-- Report Writer
    |
External Tool Runner
    |
    +-- apktool
    +-- aapt2
    +-- zipalign
    +-- apksigner
    +-- adb
```

React UI 不直接访问文件系统或执行外部命令. UI 只调用固定的 Tauri Command. Rust 后端通过统一的 `ToolRunner` 执行内置工具, 禁止接收任意命令字符串, 并返回退出码, 标准输出, 标准错误, 执行时间和脱敏后的命令参数.

### 6.3 模块职责

| 模块 | 职责 |
|---|---|
| `scanner` | 校验 APK并提取静态信息 |
| `classifier` | 判断 APK 类型和适配等级 |
| `rules` | 检测并执行有限修复规则 |
| `builder` | 解包, 重建, 对齐和签名 |
| `device` | 查询设备, 安装, 启动和采集日志 |
| `reporting` | 输出 JSON 和 Markdown 报告 |
| `src/` | React UI, 页面状态, 风险确认和结果展示 |
| `commands` | 定义前端可调用的固定 Tauri Command |
| `tooling` | 定位, 校验和执行内置外部工具 |

### 6.4 任务状态机

```text
CREATED
  -> VALIDATING
  -> SCANNING
  -> CLASSIFIED
  -> WAITING_CONFIRMATION
  -> DECODING
  -> PATCHING
  -> BUILDING
  -> ALIGNING
  -> SIGNING
  -> VERIFYING
  -> DEVICE_TESTING
  -> COMPLETED
```

任意阶段失败后进入 `FAILED`. 用户取消后进入 `CANCELLED`. 失败任务保留日志和已完成阶段, 但不得把中间 APK 标记为最终产物.

## 7. 文件和数据设计

### 7.1 项目目录

```text
apk-compat-helper/
├── package.json
├── package-lock.json
├── vite.config.ts
├── tsconfig.json
├── README.md
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   └── styles.css
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   ├── resources/
│   │   ├── common/
│   │   ├── macos/
│   │   └── windows/
│   └── src/
│       ├── lib.rs
│       ├── commands.rs
│       ├── scanner.rs
│       ├── classifier.rs
│       ├── rules.rs
│       ├── builder.rs
│       ├── device.rs
│       ├── reporting.rs
│       └── tooling.rs
├── tests/fixtures/
└── docs/
    ├── development-design.md
    └── ui-design-spec.md
```

保持单个 Tauri 应用和单个 Rust crate. 在实际出现模块过大前不增加 workspace, 多包前端或插件架构.

### 7.2 本地数据目录

使用 Tauri 路径 API 获取平台数据目录:

```text
cacheDir/apk-compat-helper/jobs/<job-id>/
appDataDir/apk-compat-helper/keys/
appDataDir/apk-compat-helper/reports/
```

Tauri 负责映射 macOS 和 Windows 的系统目录. 项目开发阶段不把 APK, 解包文件, 构建产物和设备日志写入仓库.

### 7.3 任务报告

JSON 报告至少包含:

```json
{
  "job_id": "uuid",
  "source_sha256": "...",
  "source_path": "...",
  "package_name": "...",
  "apk_type": "theme_pack",
  "support_level": "experimental",
  "sdk": {
    "min": 16,
    "target_before": 19,
    "target_after": 24,
    "target_android_version": "7.0"
  },
  "findings": [],
  "acknowledged_risks": [],
  "user_override": true,
  "applied_rules": [],
  "signature": {
    "original_sha256": "...",
    "output_sha256": "..."
  },
  "device_validation": null,
  "output_apk": "...",
  "status": "completed"
}
```

报告不得保存签名密码, ADB 授权密钥或设备中的无关日志.

## 8. 修复管线

### 8.1 扫描管线

1. 复制 APK 到任务缓存目录.
2. 计算 SHA-256.
3. 校验 ZIP 结构和安全限制.
4. 使用 `apksigner verify --verbose --print-certs` 检查签名.
5. 使用 `aapt2` 提取 Manifest 和资源元数据.
6. 直接检查 ZIP 中的 DEX, 原生库和资源结构.
7. 执行类型识别和规则检测.
8. 生成扫描报告.

### 8.2 修复管线

1. 确认适配等级, 用户选择的 targetSdk, 修改项和风险授权.
2. 使用 `apktool` 解包到任务目录.
3. 备份解码后的原 Manifest.
4. 依次执行已选规则.
5. 生成 Manifest 修改差异.
6. 使用 `apktool` 重建未签名 APK.
7. 使用 `zipalign` 生成对齐 APK.
8. 使用 `apksigner` 签名.
9. 再次验证签名, 包名, SDK 和 ZIP 结构.
10. 生成最终 APK 和报告.

### 8.3 设备验证管线

1. 使用 `adb devices -l` 获取设备.
2. 获取 Android API Level, ABI 和已安装宿主包.
3. 检查原包是否已安装及其签名冲突风险.
4. 禁止自动卸载原应用.
5. 安装新 APK.
6. 启动主 Activity或触发主题识别检查.
7. 在限定时间内采集目标进程日志.
8. 检测安装失败, 启动崩溃, SecurityException 和资源错误.
9. 更新报告中的设备验证结果.

## 9. 桌面 UI 设计

### 9.1 主界面

主界面只保留以下区域:

- APK 拖放区.
- 文件基础信息.
- 适配等级, Android 行为边界和问题列表.
- targetSdk 与对应 Android 版本选择器.
- 修复选项.
- 根据等级显示 `开始适配`, `确认风险并适配`, `继续实验性适配` 或 `仅导出报告` 按钮.
- 任务日志.
- 输出目录和 `打开目录` 按钮.

### 9.2 页面流程

```text
选择 APK
  -> 扫描结果
  -> 确认修改和签名风险
  -> 执行进度
  -> 结果与设备验证
```

不要在首版增加首页, 账户, 云同步, 历史数据库, 商店或插件市场.

### 9.3 关键交互

- 拖入文件后立即执行只读扫描.
- 风险项必须显示检测证据, 影响版本, 可能结果和是否命中硬阻断条件.
- targetSdk 改变后立即重新计算风险和适配等级.
- 风险适配和实验性适配必须由用户明确确认后继续.
- 实验性适配允许用户选择具体修改项, 不得强制应用全部规则.
- 用户忽略的风险, 选择的 targetSdk 和实际修改项必须写入报告.
- 签名前明确提示无法使用原签名升级安装.
- 遇到签名冲突时禁止自动卸载旧应用.
- 所有长任务支持取消.
- 失败信息显示具体阶段和原始工具错误摘要.
- UI 线程不得执行 APK 解包或外部命令.

### 9.4 可访问性

- 交互控件最小高度为 40 px, 主要按钮不小于 48 px.
- 所有状态同时使用文字, 不只使用颜色.
- 支持键盘导航.
- 日志区域支持复制.
- 支持深色模式.
- 关键文本保持足够对比度.

## 10. 签名设计

### 10.1 默认签名策略

- 首次签名时生成本机专用 keystore.
- 使用系统凭据存储保存 keystore 密码.
- keystore 文件写入用户数据目录.
- 允许用户选择已有 keystore.
- 同一包名默认复用同一个本地签名, 便于后续安装本工具生成的升级版本.
- 永远不声称可以恢复原开发者签名.

### 10.2 签名警告

执行签名前必须提示:

- 输出 APK 的签名与原 APK 不同.
- 输出 APK通常不能覆盖原版安装.
- 依赖原签名的主题宿主, 权限和授权可能失效.
- 卸载原应用可能删除其本地数据.

## 11. 安全要求

- 将 APK 视为不可信输入.
- 禁止执行 APK 中的代码.
- 所有解压路径限制在任务目录.
- 限制 APK 大小, ZIP 条目数量和总解压大小.
- 子进程使用参数数组, 禁止通过 Shell 拼接用户输入.
- 对日志中的密码, 用户目录和敏感参数进行脱敏.
- 默认离线运行.
- 不上传 APK, Manifest, 证书或设备日志.
- 不自动卸载应用, 清理数据或修改设备系统设置.
- 不绕过 DRM, 付费验证或反篡改保护.
- 输出文件使用新文件名, 禁止覆盖原 APK.

## 12. 错误处理

错误必须包含:

- 失败阶段.
- 工具名称.
- 退出码.
- 可读错误摘要.
- 日志文件位置.
- 是否可以重试.

错误分类:

| 类型 | 示例 | 行为 |
|---|---|---|
| 输入错误 | APK 损坏 | 停止任务 |
| 环境错误 | 缺少 Java | 提示安装或配置 |
| 实验性适配 | 存在原生引擎或代码级风险 | 展示证据, 用户确认后允许有限修改 |
| 禁止处理 | 危险 ZIP, 不完整输入或保护机制 | 停止修改, 输出允许生成的报告 |
| 重建错误 | apktool 资源失败 | 保留日志, 不输出最终 APK |
| 签名错误 | keystore 无效 | 停止任务 |
| 设备错误 | ADB 未授权 | 保留已生成 APK, 跳过设备验证 |
| 运行错误 | 启动崩溃 | 输出 APK 和失败验证报告 |

## 13. 测试设计

### 13.1 最小测试集

维护以下合法测试样本:

- 一个低 targetSdk 的资源型主题 APK.
- 一个图标包 APK.
- 一个包含 `android:exported` 问题的测试 APK.
- 一个无原生库的简单离线测试 APK.
- 一个包含 ARM 32 位 `.so` 的实验性适配 APK.
- 一个声明危险权限但未实现运行时权限申请的 APK.
- 一个损坏 ZIP APK.
- 一个存在签名冲突场景的测试 APK.

测试 APK 必须自行构建或取得明确授权, 不提交来源不明的商业 APK.

### 13.2 自动测试

- APK ZIP 安全校验.
- Manifest 信息提取.
- APK 类型分类.
- 每条修复规则的检测和修改结果.
- targetSdk 变化后的行为边界和适配等级重算.
- 实验性适配的风险确认和用户选择记录.
- 规则重复执行的幂等性.
- 命令参数构造.
- 外部工具失败映射.
- 报告 JSON Schema.
- 修复前后包名和资源完整性.

### 13.3 集成验证

每次发布至少执行:

1. 扫描全部测试 APK.
2. 修复全部推荐适配和风险适配样本.
3. 在确认风险后修复至少一个实验性适配样本.
4. 验证 `apktool` 重建成功.
5. 验证 `zipalign -c` 通过.
6. 验证 `apksigner verify` 通过.
7. 在至少一个现代 Android 模拟器或真机安装.
8. 验证硬阻断样本不会进入修改阶段.

## 14. 性能要求

- 100 MB 以下 APK 的基础扫描目标时间小于 10 秒, 不包含首次工具初始化.
- 普通资源型 APK 的修复目标时间小于 60 秒.
- UI 在扫描和构建期间保持可响应.
- 单次只并行处理一个 APK.
- 首版不实现批量队列.

## 15. 发布和依赖管理

- 使用 `package-lock.json` 固定前端依赖.
- 使用 `Cargo.lock` 固定 Rust 依赖.
- 固定 `apktool` 和 Android Build Tools 版本.
- 记录外部工具许可证和来源.
- 发布包内工具必须校验 SHA-256.
- 安装包必须携带精简 Java Runtime, `apktool`, `aapt2`, `zipalign`, `apksigner` 和 `adb`.
- 应用只能调用安装包内经过校验的工具, 不依赖用户 PATH.
- macOS 和 Windows 分别构建, 不交叉打包.
- 发布前执行恶意软件扫描和安装包签名.
- 首版优先支持 macOS, 完成核心管线后再验证 Windows.

## 16. 开发阶段

### 阶段 1: Rust 核心管线

- [ ] 初始化 Tauri 2, React, TypeScript 和 Rust 项目.
- [ ] 实现内置工具定位, 版本和 SHA-256 检查.
- [ ] 实现 APK 安全校验.
- [ ] 实现静态扫描和 JSON 报告.
- [ ] 实现适配等级判断.
- [ ] 实现 R001, R002, R004 和 R005.
- [ ] 实现解包, 重建, 对齐和签名.
- [ ] 使用测试 APK 完成端到端验证.

完成标准: Rust 核心测试可以把推荐适配或用户确认风险的主题 APK 修复为签名有效的新 APK.

### 阶段 2: 桌面 UI

- [ ] 实现拖放 APK.
- [ ] 展示扫描结果和适配等级.
- [ ] 提供 targetSdk 和对应 Android 版本选择器.
- [ ] 展示跨 targetSdk 行为风险并支持用户确认后继续.
- [ ] 展示修复规则和签名风险.
- [ ] 展示进度, 日志和取消操作.
- [ ] 展示输出文件和报告.

完成标准: 用户无需终端即可完成扫描和修复.

### 阶段 3: ADB 验证

- [ ] 实现设备列表和授权状态.
- [ ] 获取设备 Android 版本和 ABI.
- [ ] 检测主题宿主包.
- [ ] 安装 APK并采集错误.
- [ ] 启动应用或执行主题识别检查.
- [ ] 写入设备验证报告.

完成标准: 工具可以区分构建成功与设备验证成功.

### 阶段 4: 发布

- [ ] 固定依赖版本.
- [ ] 使用 Tauri Bundler 打包 macOS 应用.
- [ ] 验证安装包内置 Java Runtime 和 Android 工具完整可用.
- [ ] 验证全新机器安装.
- [ ] 完成许可证清单.
- [ ] 完成隐私和使用边界说明.

完成标准: 非开发用户可以安装并处理测试 APK.

## 17. 首版验收标准

首版必须同时满足以下条件:

- [ ] 输入 APK 永远不被覆盖.
- [ ] 损坏或危险 ZIP 被拒绝.
- [ ] 能识别包名, SDK, 签名, DEX 和原生库.
- [ ] 能识别至少一种主题或图标包协议.
- [ ] 能识别原生游戏和代码级风险, 并标记为实验性适配.
- [ ] 能区分兼容性风险和必须硬阻断的安全边界.
- [ ] 实验性适配经用户确认后仍可选择有限修改.
- [ ] 能执行 R001, R002, R004 和 R005 规定的检测或处理.
- [ ] 输出 APK 通过 `zipalign` 和 `apksigner` 验证.
- [ ] 报告记录全部修改和签名变化.
- [ ] 设备验证失败不会删除已生成 APK.
- [ ] 不连接网络也能完成核心流程.

## 18. 风险与控制

| 风险 | 影响 | 控制措施 |
|---|---|---|
| 提高 targetSdk 后行为变化 | 应用安装成功但运行失败 | 选择设备允许的最低值, 必须执行设备验证 |
| 危险权限在实际路径中未使用 | 静态分析可能高估风险 | 标记实验性适配, 用户确认后允许继续 |
| 缺少运行时权限申请代码 | 相关功能失败或崩溃 | 展示检测证据和影响版本, 不宣称适配成功 |
| 重新签名破坏宿主识别 | 主题无法加载 | 扫描签名依赖, 明确标记风险适配 |
| apktool 无法重建资源 | 无法生成 APK | 保存日志, 不输出伪成功结果 |
| 主题协议已经淘汰 | 修复无效 | 检查宿主包和协议, 不宣称通用兼容 |
| 游戏包含隐藏原生依赖 | 启动崩溃 | 扫描 `lib/`, 引擎特征和加载库调用 |
| 不可信 APK 消耗大量磁盘 | 本机资源耗尽 | 设置大小, 条目数量和解压体积限制 |
| 用户误卸载原应用 | 数据丢失 | 工具禁止自动卸载 |

## 19. 后续扩展条件

只有出现明确样本和可复现需求后再增加以下能力:

- 当 Split APK 样本占显著比例时增加 APKS 支持.
- 当同一 Smali 问题在多个合法样本中重复出现时增加专用规则.
- 当用户需要批量处理且单任务稳定后增加队列.
- 当 Windows 用户验证核心价值后增加 Windows 发布.
- 当规则数量影响维护时再拆分规则包.
- 当本地报告不足以定位问题时再增加可选诊断导出.

不要预先实现云服务, AI 自动改码, 插件市场或通用反编译编辑器.

## 20. 下一步执行清单

- [ ] 将目录从 `app-compact-helper` 改为 `apk-compat-helper`.
- [ ] 初始化 Git 仓库.
- [ ] 初始化 Tauri 2 + React + TypeScript 项目.
- [ ] 建立 Rust 核心模块和固定 Tauri Command 边界.
- [ ] 准备 macOS 内置工具资源目录和 SHA-256 清单.
- [ ] 创建一个自行构建的低 targetSdk 主题测试 APK.
- [ ] 先实现 Rust 扫描核心和最小测试入口.
- [ ] 用真实扫描结果校正规则字段和适配等级.
- [ ] 扫描稳定后再开发桌面 UI.
