import React, { useEffect, useState } from "react";
import {
  AndroidLogo,
  ArrowClockwise,
  ArrowRight,
  CaretDown,
  Check,
  CircleNotch,
  DeviceMobile,
  Desktop,
  FileArrowUp,
  FileZip,
  FolderOpen,
  GearSix,
  Moon,
  ShieldCheck,
  Sun,
  Warning,
  X,
} from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";

const isTauri = () => Boolean(window.__TAURI_INTERNALS__);
const formatSize = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const progressStages = {
  validating: [8, ["正在检查 APK", "Checking APK"]], decoding: [20, ["正在解包资源", "Unpacking resources"]], patching: [36, ["正在修改兼容参数", "Updating compatibility settings"]],
  building: [54, ["正在重新构建 APK", "Rebuilding APK"]], aligning: [70, ["正在执行 ZIP 对齐", "Running ZIP alignment"]], signing: [82, ["正在生成兼容签名", "Creating compatible signature"]],
  verifying: [92, ["正在验证输出文件", "Verifying output"]], reporting: [97, ["正在生成修复报告", "Creating repair report"]], completed: [100, ["处理完成", "Completed"],],
};
const languageText = {
  zh: { subtitle: "旧 APK适配工具", settings: "设置", language: "语言", theme: "外观", system: "跟随系统", light: "浅色", dark: "深色", version: "版本", firstTitle: "选择界面语言", firstBody: "可以随时在设置中更改", confirm: "开始使用", close: "完成", step1: "第 1 步, 选择 APK", title: "修复旧 APK, 让它能在新设备上安装", privacy: "文件只在本机处理. 原 APK不会被覆盖.", drop: "拖入 APK, 或点击选择", scanning: "正在安全解析 APK...", parsed: "已解析", before: "修改前", after: "修改后", advanced: "调整修复参数", target: "目标 targetSDK", output: "输出位置", change: "更改", start: "开始自动修复", step2: "第 2 步, 自动修复", step3: "第 3 步, 获取新 APK", done: "APK 修复完成", openFolder: "打开 APK 所在目录", adb: "安装到 Android 设备", refresh: "刷新设备", install: "安装 APK 到设备", another: "处理另一个 APK", failed: "操作未完成" },
  en: { subtitle: "Legacy APK adapter", settings: "Settings", language: "Language", theme: "Appearance", system: "System", light: "Light", dark: "Dark", version: "Version", firstTitle: "Choose interface language", firstBody: "You can change this later in Settings", confirm: "Get started", close: "Done", step1: "Step 1, choose an APK", title: "Repair a legacy APK for newer Android devices", privacy: "Files stay on this computer. The original APK is never overwritten.", drop: "Drop an APK here, or click to choose", scanning: "Scanning APK safely...", parsed: "Parsed", before: "Before", after: "After", advanced: "Repair options", target: "Target SDK", output: "Output location", change: "Change", start: "Start automatic repair", step2: "Step 2, repair", step3: "Step 3, get the APK", done: "APK repair complete", openFolder: "Open APK folder", adb: "Install on Android device", refresh: "Refresh devices", install: "Install APK on device", another: "Process another APK", failed: "Operation failed" },
};

function App() {
  const [report, setReport] = useState(null);
  const [advanced, setAdvanced] = useState(false);
  const [target, setTarget] = useState(24);
  const [exported, setExported] = useState(true);
  const [cleartext, setCleartext] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [repairResult, setRepairResult] = useState(null);
  const [devices, setDevices] = useState([]);
  const [deviceStatus, setDeviceStatus] = useState("");
  const [selectedSerial, setSelectedSerial] = useState("");
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [outputPath, setOutputPath] = useState("");
  const [progressStage, setProgressStage] = useState("validating");
  const [language, setLanguage] = useState(() => localStorage.getItem("apk-helper-language") || (navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en"));
  const [theme, setTheme] = useState(() => localStorage.getItem("apk-helper-theme") || "system");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [firstLaunch, setFirstLaunch] = useState(() => !localStorage.getItem("apk-helper-language-confirmed"));
  const [appVersion, setAppVersion] = useState("0.1.6");
  const copy = languageText[language];
  const stage = progressStages[progressStage] ?? [5, ["正在处理 APK", "Processing APK"]];
  const findingText = { runtime_permission_missing: ["动态权限", "Runtime permissions"], native_libraries: ["原生库", "Native libraries"], cleartext_http: ["明文 HTTP", "Cleartext HTTP"] };
  const summaryText = { recommended: ["可以直接修复", "Ready to repair"], risk: ["可以尝试修复", "Repair with risks"], experimental: ["实验性修复", "Experimental repair"] };
  const findingCopy = (finding) => findingText[finding?.id]?.[language === "zh" ? 0 : 1] ?? finding?.title;
  const summaryCopy = summaryText[report?.supportLevel]?.[language === "zh" ? 0 : 1] ?? report?.summary;
  const changeCount = Number(target !== report?.targetBefore) + Number(exported) + Number(cleartext);

  const scanPath = async (path, requestedTarget) => {
    setStatus("scanning");
    setError("");
    setRepairResult(null);
    try {
      const next = await invoke("scan_apk", { path, targetSdk: requestedTarget });
      setReport(next);
      setTarget(next.targetAfter);
      if (requestedTarget == null) setOutputPath(next.suggestedOutputPath);
      setStatus("ready");
    } catch (reason) {
      setReport(null);
      setStatus("error");
      setError(String(reason));
    }
  };

  const chooseFile = async () => {
    if (!isTauri()) {
      setError("请在桌面程序中选择 APK. 浏览器预览不具备本地解析能力.");
      setStatus("error");
      return;
    }
    const path = await open({ multiple: false, filters: [{ name: "Android APK", extensions: ["apk"] }] });
    if (path) await scanPath(path, null);
  };

  useEffect(() => {
    if (!isTauri()) return undefined;
    let unlisten;
    getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "drop" && event.payload.paths[0]) {
        scanPath(event.payload.paths[0], null);
      }
    }).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!isTauri()) return undefined;
    let unlisten;
    listen("repair-progress", (event) => setProgressStage(event.payload)).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, []);

  const changeTarget = async (nextTarget) => {
    setTarget(nextTarget);
    if (report?.sourcePath) await scanPath(report.sourcePath, nextTarget);
  };

  const removeFile = () => {
    setReport(null);
    setError("");
    setStatus("idle");
    setRepairResult(null);
    setDevices([]);
    setDeviceStatus("");
    setSelectedSerial("");
    setOutputPath("");
  };

  const chooseOutput = async () => {
    try {
      const path = await save({ defaultPath: outputPath, filters: [{ name: "Android APK", extensions: ["apk"] }] });
      if (path) setOutputPath(path);
    } catch (reason) {
      setError(String(reason));
    }
  };

  const startRepair = async () => {
    if (status === "ready") {
      setStatus("confirm");
      return;
    }
    try {
      if (!outputPath) throw new Error("请先选择输出位置");
      setProgressStage("validating");
      setStatus("repairing");
      setError("");
      const result = await invoke("repair_apk", {
        path: report.sourcePath,
        outputPath,
        options: { targetSdk: target, addExported: exported, allowCleartext: cleartext },
      });
      setRepairResult(result);
      setStatus("done");
      await refreshDevices();
    } catch (reason) {
      setStatus("ready");
      setError(String(reason));
    }
  };

  const installToDevice = async () => {
    const device = devices.find((item) => item.serial === selectedSerial && item.status === "device");
    if (!device) return;
    setDeviceStatus("installing");
    try {
      await invoke("install_apk", { serial: device.serial, path: repairResult.outputPath });
      setDeviceStatus(language === "zh" ? `已安装到 ${device.model}` : `Installed on ${device.model}`);
    } catch (reason) {
      setDeviceStatus(String(reason));
    }
  };

  const refreshDevices = async () => {
    setDevicesLoading(true);
    setDeviceStatus("");
    try {
      const next = await invoke("list_devices");
      setDevices(next);
      const ready = next.find((item) => item.status === "device");
      setSelectedSerial(ready?.serial ?? "");
      if (!ready && next.some((item) => item.status === "unauthorized")) {
        setDeviceStatus(language === "zh" ? "已发现设备, 请在手机上允许 USB 调试后再次刷新." : "Device found. Allow USB debugging on the device, then refresh.");
      }
    } catch (reason) {
      setDevices([]);
      setSelectedSerial("");
      setDeviceStatus(String(reason));
    } finally {
      setDevicesLoading(false);
    }
  };

  const revealOutput = async () => {
    try {
      await invoke("reveal_path", { path: repairResult.outputPath });
    } catch (reason) {
      setDeviceStatus(String(reason));
    }
  };

  const topFinding = report?.findings[0];

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("apk-helper-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (isTauri()) getVersion().then(setAppVersion).catch(() => {});
  }, []);

  const confirmLanguage = () => {
    localStorage.setItem("apk-helper-language-confirmed", "1");
    localStorage.setItem("apk-helper-language", language);
    setFirstLaunch(false);
  };

  const changeLanguage = (next) => {
    setLanguage(next);
    localStorage.setItem("apk-helper-language", next);
  };

  return (
    <main className="app">
      <header className="app-bar">
        <div className="brand">
          <span className="brand-icon"><AndroidLogo weight="fill" /></span>
          <div><strong>APK Compat Helper</strong><small>{copy.subtitle}</small></div>
        </div>
        <button className="icon-button" aria-label={copy.settings} onClick={() => setSettingsOpen(true)}><GearSix /></button>
      </header>

      {firstLaunch && <LanguageDialog language={language} setLanguage={changeLanguage} copy={copy} onConfirm={confirmLanguage} />}
      {settingsOpen && <SettingsDialog language={language} setLanguage={changeLanguage} theme={theme} setTheme={setTheme} copy={copy} version={appVersion} onClose={() => setSettingsOpen(false)} />}

      <section className="tool-card">
        {status === "confirm" ? (
          <div className="process-page confirm-page">
            <span className="process-icon"><ArrowRight weight="bold" /></span>
            <p className="step-label">{copy.step2}</p>
            <h1>{language === "zh" ? "确认修复设置" : "Confirm repair settings"}</h1>
            <p>{language === "zh" ? "确认输出位置后开始处理, 原 APK不会被覆盖." : "Confirm the output location before processing. The original APK is never overwritten."}</p>
            <div className="output-row confirm-output"><span><strong>{copy.output}</strong><small>{language === "zh" ? "默认保存在原 APK 所在目录" : "Saved next to the source APK by default"}</small></span><button onClick={chooseOutput}><FolderOpen />{copy.change}</button><code>{outputPath}</code></div>
            <button className="primary-button" onClick={startRepair}>{language === "zh" ? "开始修复" : "Start repair"} <ArrowRight weight="bold" /></button>
            <button className="secondary-button" onClick={() => setStatus("ready")}>{language === "zh" ? "返回检查" : "Back to review"}</button>
          </div>
        ) : status === "repairing" ? (
          <div className="process-page">
            <span className="process-icon"><CircleNotch weight="bold" /></span>
            <p className="step-label">{copy.step2}</p>
            <h1>{stage[1][language === "zh" ? 0 : 1]}</h1>
            <p>{language === "zh" ? "程序仍可正常响应, 请不要移动原 APK 或关闭应用." : "The app remains responsive. Do not move the source APK or close the app."}</p>
            <div className="progress-track"><i style={{ width: `${progressStages[progressStage]?.[0] ?? 5}%` }} /></div>
            <div className="progress-meta"><span>{progressStages[progressStage]?.[0] ?? 5}%</span><span>{report.fileName}</span></div>
            <div className="output-preview"><span>{copy.output}</span><strong>{outputPath}</strong></div>
          </div>
        ) : status === "done" && repairResult ? (
          <div className="result-page">
            <span className="result-check"><Check weight="bold" /></span>
            <p className="step-label">{copy.step3}</p>
            <h1>{copy.done}</h1>
            <p>{language === "zh" ? "签名和 ZIP 对齐验证均已通过, 输出目录只保留最终 APK." : "Signing and ZIP alignment passed. Only the final APK is kept in the output folder."}</p>
            <div className="result-files"><span>新 APK</span><strong>{repairResult.outputPath}</strong></div>
            <button className="secondary-button open-output" onClick={revealOutput}><FolderOpen />{copy.openFolder}</button>
            <section className="adb-panel">
              <div className="adb-heading">
                <span><DeviceMobile weight="fill" /><span><strong>{copy.adb}</strong><small>{language === "zh" ? "连接 USB 并开启 USB 调试" : "Connect USB and enable USB debugging"}</small></span></span>
                <button onClick={refreshDevices} disabled={devicesLoading}><ArrowClockwise className={devicesLoading ? "spinning" : ""} />{devicesLoading ? (language === "zh" ? "正在刷新" : "Refreshing") : copy.refresh}</button>
              </div>
              {devices.length > 0 ? (
                <div className="device-picker">
                  <label htmlFor="device-select">选择设备</label>
                  <span className="select-control"><select id="device-select" value={selectedSerial} onChange={(event) => setSelectedSerial(event.target.value)}><option value="">请选择已授权设备</option>{devices.map((device) => <option key={device.serial} value={device.status === "device" ? device.serial : ""}>{device.model} · {device.status === "device" ? "已连接" : device.status === "unauthorized" ? "等待授权" : "不可用"}</option>)}</select><CaretDown weight="bold" /></span>
                </div>
              ) : <div className="device-empty">{language === "zh" ? "未检测到设备. 连接后点击刷新设备." : "No device found. Connect one, then refresh."}</div>}
              <button className="install-button" onClick={installToDevice} disabled={!selectedSerial || deviceStatus === "installing"}>{deviceStatus === "installing" ? (language === "zh" ? "正在安装 APK..." : "Installing APK...") : copy.install}</button>
              {deviceStatus && deviceStatus !== "installing" && <p className="device-status">{deviceStatus}</p>}
            </section>
            <button className="secondary-button" onClick={removeFile}>{copy.another}</button>
          </div>
        ) : (
        <>
        <div className="intro">
          <p className="step-label">{copy.step1}</p>
          <h1>{copy.title}</h1>
          <p>{copy.privacy}</p>
        </div>

        {report ? (
          <div className="file-row">
            <span className="file-icon"><FileZip weight="fill" /></span>
            <div className="file-copy">
              <strong>{report.fileName}</strong>
              <span>{formatSize(report.fileSize)} · {report.targetBeforeDeclared ? `targetSDK ${report.targetBefore}` : "targetSDK 未声明"} · {report.apkType}</span>
            </div>
              <span className="scan-status"><Check weight="bold" /> {copy.parsed}</span>
            <button className="remove-button" aria-label="移除 APK" onClick={removeFile}><X /></button>
          </div>
        ) : (
          <button className={`drop-zone ${status === "scanning" ? "loading" : ""}`} onClick={chooseFile} disabled={status === "scanning"}>
            <FileArrowUp />
            <strong>{status === "scanning" ? copy.scanning : copy.drop}</strong>
            <span>{language === "zh" ? "支持单个 .apk 文件, 最大 2 GB" : "One .apk file, up to 2 GB"}</span>
          </button>
        )}

        {error && <div className="error-line"><Warning weight="fill" /><span><strong>{copy.failed}</strong>{error}</span></div>}

        {report && (
          <>
            <div className={`result-line ${report.supportLevel}`}>
              <span className="result-icon"><ShieldCheck weight="fill" /></span>
              <div>
                <strong>{summaryCopy}</strong>
                <p>{topFinding ? (language === "zh" ? `检测到 ${report.findings.length} 项需要确认的兼容风险, 仍允许继续修复.` : `${report.findings.length} compatibility finding${report.findings.length === 1 ? "" : "s"} require review. Repair can continue.`) : (language === "zh" ? "未发现会阻止继续处理的明显兼容问题." : "No obvious issue prevents continuing.")}</p>
              </div>
            </div>

            {report.findings.length > 0 && (
              <div className="finding-list" aria-label={language === "zh" ? "兼容性问题" : "Compatibility findings"}>
                {report.findings.map((finding) => (
                  <div className="finding-item" key={finding.id}>
                    <Warning weight="fill" />
                    <span className="finding-copy">
                      <strong>{findingCopy(finding)}</strong>
                      {finding.permissionDetails?.length > 0 ? (
                        <>
                          <small>{language === "zh" ? "Manifest 声明了以下动态权限, 但未检测到常见的运行时申请特征." : "The manifest declares these runtime permissions, but common request patterns were not detected."}</small>
                          <div className="permission-list">
                            {finding.permissionDetails.map((permission) => (
                              <div className="permission-item" key={permission.name}>
                                <div><strong>{language === "zh" ? permission.label : permission.labelEn}</strong><code>{permission.name}</code></div>
                                <p>{language === "zh" ? permission.description : permission.descriptionEn}</p>
                              </div>
                            ))}
                          </div>
                          <small>{language === "zh" ? `提升到 targetSDK ${target} 后相关功能可能需要设备验证, 仍允许继续修复.` : `After raising targetSDK to ${target}, related features may require device testing. Repair can continue.`}</small>
                        </>
                      ) : <small>{finding.summary}</small>}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="parameter-compare" aria-label="修改前后参数对比">
              <div>
                <span>{copy.before}</span>
                <strong>{report.targetBeforeDeclared ? `targetSDK ${report.targetBefore}` : "targetSDK 未声明"}</strong>
                <small>{report.targetBeforeDeclared ? `Android ${report.targetBeforeAndroidVersion}` : `系统按 API ${report.targetBefore} · Android ${report.targetBeforeAndroidVersion} 处理`}</small>
              </div>
              <ArrowRight weight="bold" />
              <div className="after">
                <span>{copy.after}</span>
                <strong>targetSDK {target}</strong>
                <small>Android {report.targetAndroidVersion}</small>
              </div>
            </div>

            <button className={`advanced-trigger ${advanced ? "open" : ""}`} onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
              <span><GearSix /> {copy.advanced} <small>{language === "zh" ? `将修改 ${changeCount} 项, 一般不需要调整` : `${changeCount} change${changeCount === 1 ? "" : "s"}, usually no adjustment needed`}</small></span>
              <CaretDown />
            </button>

            {advanced && (
              <div className="advanced-panel">
                <label className="field-row">
                  <span><strong>{copy.target}</strong><small>{language === "zh" ? "选择目标设备允许的版本" : "Choose the version allowed by the target device"}</small></span>
                  <span className="select-control">
                    <select value={target} onChange={(event) => changeTarget(Number(event.target.value))} disabled={status === "scanning" || status === "repairing"}>
                      {report.androidVersions.map((version) => <option value={version.api} key={version.api}>API {version.api} · Android {version.android}</option>)}
                    </select>
                    <CaretDown weight="bold" />
                  </span>
                </label>
                <Option checked={exported} onChange={setExported} title="补充组件导出声明" description="仅修改语义明确的主入口" />
                <Option checked={cleartext} onChange={setCleartext} title="允许明文 HTTP" description="存在安全风险, 默认关闭" warning />
              </div>
            )}

            <div className="primary-area">
              <button className="primary-button" onClick={startRepair}>{language === "zh" ? "下一步" : "Next"} <ArrowRight weight="bold" /></button>
              <p>{language === "zh" ? "下一步确认输出位置后开始修复" : "Confirm the output location on the next step"}</p>
            </div>
          </>
        )}
        </>
        )}
      </section>

      <footer className="flow-note">
        <span className={report ? "" : "active"}>1 选择 APK</span><i /><span className={status === "confirm" || status === "repairing" ? "active" : ""}>2 自动修复</span><i /><span className={status === "done" ? "active" : ""}>3 获取新 APK</span>
      </footer>
    </main>
  );
}

function Option({ checked, onChange, title, description, warning = false }) {
  return (
    <label className="option-row">
      <span><strong>{title}</strong><small className={warning ? "warning" : ""}>{description}</small></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i className="switch" aria-hidden="true" />
    </label>
  );
}

function LanguageDialog({ language, setLanguage, copy, onConfirm }) {
  return <div className="modal-backdrop"><section className="setup-dialog" role="dialog" aria-modal="true"><span className="setup-mark"><AndroidLogo weight="fill" /></span><h2>{copy.firstTitle}</h2><p>{copy.firstBody}</p><div className="language-options"><button className={language === "zh" ? "selected" : ""} onClick={() => setLanguage("zh")}>简体中文</button><button className={language === "en" ? "selected" : ""} onClick={() => setLanguage("en")}>English</button></div><button className="primary-button" onClick={onConfirm}>{copy.confirm}<ArrowRight weight="bold" /></button></section></div>;
}

function SettingsDialog({ language, setLanguage, theme, setTheme, copy, version, onClose }) {
  return <div className="settings-backdrop"><aside className="settings-sheet" role="dialog" aria-modal="true"><header className="settings-sheet-head"><div><span>{copy.settings}</span><h2>APK Compat Helper</h2></div><button className="remove-button" onClick={onClose} aria-label={copy.close}><X /></button></header><div className="settings-content"><section className="settings-group"><p>{copy.language}</p><div className="setting-segments language-segments"><button className={language === "zh" ? "selected" : ""} onClick={() => setLanguage("zh")}>简体中文</button><button className={language === "en" ? "selected" : ""} onClick={() => setLanguage("en")}>English</button></div></section><section className="settings-group"><p>{copy.theme}</p><div className="setting-segments theme-segments"><button className={theme === "system" ? "selected" : ""} onClick={() => setTheme("system")}><Desktop />{copy.system}</button><button className={theme === "light" ? "selected" : ""} onClick={() => setTheme("light")}><Sun />{copy.light}</button><button className={theme === "dark" ? "selected" : ""} onClick={() => setTheme("dark")}><Moon />{copy.dark}</button></div></section><section className="about-card"><span className="brand-icon"><AndroidLogo weight="fill" /></span><div><strong>APK Compat Helper</strong><small>{copy.version} {version}</small><small>{copy.subtitle}</small></div></section></div><footer className="settings-footer"><span>Local only · Tauri</span><button onClick={onClose}>{copy.close}</button></footer></aside></div>;
}

export default App;
