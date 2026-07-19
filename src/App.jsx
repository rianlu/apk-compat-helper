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
  FolderOpen,
  GearSix,
  Moon,
  ShieldCheck,
  Sun,
  Warning,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import appIcon from "../src-tauri/app-icon.svg";

const isTauri = () => Boolean(window.__TAURI_INTERNALS__);
const isMacOS = navigator.userAgent.includes("Macintosh");
const formatSize = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const fileNameFromPath = (path) => path.split(/[\\/]/).pop();
const parentPath = (path) => path.replace(/[\\/][^\\/]+$/, "");
const joinPath = (directory, name) => `${directory}${directory.endsWith("\\") || directory.endsWith("/") ? "" : directory.includes("\\") ? "\\" : "/"}${name}`;
const resultFolderName = (language) => language === "zh" ? "修复结果" : "Repaired APKs";
const progressStages = {
  validating: [8, ["正在检查 APK", "Checking APK"]], decoding: [20, ["正在解包资源", "Unpacking resources"]], patching: [36, ["正在修改兼容参数", "Updating compatibility settings"]],
  building: [54, ["正在重新构建 APK", "Rebuilding APK"]], aligning: [70, ["正在执行 ZIP 对齐", "Running ZIP alignment"]], signing: [82, ["正在生成兼容签名", "Creating compatible signature"]],
  verifying: [92, ["正在验证输出文件", "Verifying output"]], reporting: [97, ["正在生成修复报告", "Creating repair report"]], completed: [100, ["处理完成", "Completed"],],
};
const languageText = {
  zh: { subtitle: "旧 APK适配工具", settings: "设置", language: "语言", theme: "外观", system: "跟随系统", light: "浅色", dark: "深色", version: "版本", firstTitle: "选择界面语言", firstBody: "可以随时在设置中更改", confirm: "开始使用", close: "完成", step1: "第 1 步, 选择 APK", title: "修复旧 APK, 让它能在新设备上安装", privacy: "文件只在本机处理. 原 APK不会被覆盖.", drop: "拖入一个或多个 APK, 或点击选择", scanning: "正在安全解析 APK...", parsed: "已解析", before: "修改前", after: "修改后", advanced: "调整修复参数", target: "目标 targetSDK", output: "输出位置", change: "更改", start: "开始自动修复", step2: "第 2 步, 自动修复", step3: "第 3 步, 获取新 APK", done: "APK 修复完成", openFolder: "打开结果目录", adb: "安装到 Android 设备", refresh: "刷新设备", install: "安装 APK 到设备", installSelected: "安装选中的 APK", batchInstallHint: "可选择一个或多个已修复 APK 安装到设备", selectedForInstall: "已选择", selectAll: "全选", clearSelection: "清空", another: "处理其他 APK", failed: "操作未完成" },
  en: { subtitle: "Legacy APK adapter", settings: "Settings", language: "Language", theme: "Appearance", system: "System", light: "Light", dark: "Dark", version: "Version", firstTitle: "Choose interface language", firstBody: "You can change this later in Settings", confirm: "Get started", close: "Done", step1: "Step 1, choose APKs", title: "Repair legacy APKs for newer Android devices", privacy: "Files stay on this computer. Original APKs are never overwritten.", drop: "Drop one or more APKs here, or click to choose", scanning: "Scanning APKs safely...", parsed: "Parsed", before: "Before", after: "After", advanced: "Repair options", target: "Target SDK", output: "Output location", change: "Change", start: "Start automatic repair", step2: "Step 2, repair", step3: "Step 3, get APKs", done: "APK repair complete", openFolder: "Open results folder", adb: "Install on Android device", refresh: "Refresh devices", install: "Install APK on device", installSelected: "Install selected APKs", batchInstallHint: "Choose one or more repaired APKs to install on the device", selectedForInstall: "Selected", selectAll: "Select all", clearSelection: "Clear", another: "Process other APKs", failed: "Operation failed" },
};

function App() {
  const [report, setReport] = useState(null);
  const [batchItems, setBatchItems] = useState([]);
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
  const [batchOutputDir, setBatchOutputDir] = useState("");
  const [batchResults, setBatchResults] = useState([]);
  const [batchInstallSelection, setBatchInstallSelection] = useState([]);
  const [batchInstallResults, setBatchInstallResults] = useState({});
  const [batchInstalling, setBatchInstalling] = useState(false);
  const [batchIndex, setBatchIndex] = useState(0);
  const [riskReport, setRiskReport] = useState(null);
  const [progressStage, setProgressStage] = useState("validating");
  const [language, setLanguage] = useState(() => localStorage.getItem("apk-helper-language") || (navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en"));
  const [theme, setTheme] = useState(() => localStorage.getItem("apk-helper-theme") || "system");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [firstLaunch, setFirstLaunch] = useState(() => !localStorage.getItem("apk-helper-language-confirmed"));
  const [appVersion, setAppVersion] = useState("0.1.6");
  const copy = languageText[language];
  const stage = progressStages[progressStage] ?? [5, ["正在处理 APK", "Processing APK"]];
  const findingText = { runtime_permission_missing: ["动态权限", "Runtime permissions"], native_libraries: ["原生库", "Native libraries"], cleartext_http: ["明文 HTTP", "Cleartext HTTP"], invalid_resources: ["无效资源文件", "Invalid resource files"] };
  const findingSummaryText = {
    runtime_permission_missing: ["未检测到常见的运行时权限申请特征, 但无法确认实际代码路径. 提升 targetSDK 后, 相关功能可能失效.", "Common runtime permission request patterns were not detected, but actual code paths cannot be confirmed. Related features may stop working after raising targetSDK."],
    native_libraries: ["工具不会修改 APK 中的原生代码, 修复结果需要在目标设备上验证.", "Native code inside the APK is not modified. Test the repaired APK on the target device."],
    cleartext_http: ["相关网络功能可能在 Android 9及以上受到限制.", "Related network features may be restricted on Android 9 or later."],
    invalid_resources: ["APK 中存在标准 AAPT2 无法重新编译的空资源. 原 APK不一定损坏, 但当前无法在修改后安全重建.", "The APK contains empty resources that standard AAPT2 cannot recompile. The original is not necessarily damaged, but it cannot currently be rebuilt safely after modification."],
  };
  const summaryText = { recommended: ["可以直接修复", "Ready to repair"], risk: ["可以尝试修复", "Repair with risks"], experimental: ["实验性修复", "Experimental repair"] };
  const findingCopy = (finding) => findingText[finding?.id]?.[language === "zh" ? 0 : 1] ?? finding?.title;
  const findingSummaryCopy = (finding) => findingSummaryText[finding?.id]?.[language === "zh" ? 0 : 1] ?? finding?.summary;
  const summaryCopy = summaryText[report?.supportLevel]?.[language === "zh" ? 0 : 1] ?? report?.summary;
  const changeCount = Number(target !== report?.targetBefore) + Number(exported) + Number(cleartext);
  const isBatch = batchItems.length > 1;
  const successfulBatchPaths = batchResults.filter((item) => item.status === "done").map((item) => item.result.outputPath);
  const errorSummary = (message) => {
    if (/PNG signature|file failed to compile|no element found/i.test(message)) return language === "zh" ? "原 APK不一定损坏, 但其资源无法由标准 AAPT2 重新编译, 当前无法安全修复." : "The original APK is not necessarily damaged, but its resources cannot be recompiled by standard AAPT2, so it cannot currently be repaired safely.";
    if (/输出文件已存在|output file already exists/i.test(message)) return language === "zh" ? "输出位置已有同名文件, 请更改文件名." : "A file with the same name already exists in the output location. Choose another name.";
    return language === "zh" ? "处理失败, 请查看完整原因." : "Processing failed. View the full details.";
  };

  const scanPath = async (path, requestedTarget) => {
    setStatus("scanning");
    setError("");
    setRepairResult(null);
    setBatchInstallSelection([]);
    setBatchInstallResults({});
    try {
      const next = await invoke("scan_apk", { path, targetSdk: requestedTarget });
      setReport(next);
      setTarget(next.targetAfter);
      if (requestedTarget == null) {
        const defaultPath = joinPath(joinPath(parentPath(next.sourcePath), resultFolderName(language)), fileNameFromPath(next.suggestedOutputPath));
        setOutputPath(await invoke("available_output_path", { path: defaultPath }));
      }
      setStatus("ready");
    } catch (reason) {
      setReport(null);
      setStatus("error");
      setError(String(reason));
    }
  };

  const scanPaths = async (paths) => {
    const apkPaths = [...new Set(paths)].filter((path) => path.toLowerCase().endsWith(".apk"));
    if (!apkPaths.length) return;
    if (apkPaths.length === 1) {
      setBatchItems([]);
      await scanPath(apkPaths[0], null);
      return;
    }
    setStatus("scanning");
    setError("");
    setReport(null);
    setBatchResults([]);
    setBatchInstallSelection([]);
    setBatchInstallResults({});
    const items = [];
    for (const path of apkPaths) {
      try {
        const next = await invoke("scan_apk", { path, targetSdk: null });
        items.push({ report: next, target: next.targetAfter, status: "ready", error: "" });
      } catch (reason) {
        items.push({ path, fileName: fileNameFromPath(path), status: "failed", error: String(reason) });
      }
    }
    setBatchItems(items);
    setBatchOutputDir(joinPath(parentPath(apkPaths[0]), resultFolderName(language)));
    setStatus("ready");
  };

  const chooseFile = async () => {
    if (!isTauri()) {
      setError(language === "zh" ? "请在桌面程序中选择 APK. 浏览器预览不具备本地解析能力." : "Choose APKs in the desktop app. Browser preview cannot access local files.");
      setStatus("error");
      return;
    }
    const paths = await open({ multiple: true, filters: [{ name: "Android APK", extensions: ["apk"] }] });
    if (paths) await scanPaths(Array.isArray(paths) ? paths : [paths]);
  };

  useEffect(() => {
    if (!isTauri()) return undefined;
    let unlisten;
    getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "drop" && event.payload.paths[0]) {
        scanPaths(event.payload.paths);
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
    setBatchItems([]);
    setBatchResults([]);
    setBatchInstallSelection([]);
    setBatchInstallResults({});
    setBatchInstalling(false);
    setError("");
    setStatus("idle");
    setRepairResult(null);
    setDevices([]);
    setDeviceStatus("");
    setSelectedSerial("");
    setOutputPath("");
    setBatchOutputDir("");
  };

  const removeBatchItem = (index) => {
    const next = batchItems.filter((_, itemIndex) => itemIndex !== index);
    if (next.length === 1 && next[0].report) {
      setReport(next[0].report);
      setTarget(next[0].target);
      setOutputPath(next[0].report.suggestedOutputPath);
      setBatchItems([]);
      return;
    }
    if (!next.length) removeFile();
    else setBatchItems(next);
  };

  const chooseOutput = async () => {
    try {
      if (isBatch) {
        const path = await open({ directory: true, defaultPath: batchOutputDir });
        if (path) setBatchOutputDir(path);
        return;
      }
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
      if (isBatch) {
        if (!batchOutputDir) throw new Error(language === "zh" ? "请先选择输出目录" : "Choose an output folder first");
        setStatus("repairing");
        setError("");
        setBatchResults([]);
        setBatchInstallSelection([]);
        setBatchInstallResults({});
        const results = [];
        for (let index = 0; index < batchItems.length; index += 1) {
          const item = batchItems[index];
          setBatchIndex(index);
          setProgressStage("validating");
          if (!item.report) {
            results.push({ ...item, status: "failed" });
            setBatchResults([...results]);
            continue;
          }
          try {
            const suggestedName = fileNameFromPath(item.report.suggestedOutputPath);
            const uniqueOutputPath = await invoke("available_output_path", { path: joinPath(batchOutputDir, suggestedName) });
            const result = await invoke("repair_apk", {
              path: item.report.sourcePath,
              outputPath: uniqueOutputPath,
              options: { targetSdk: item.target, addExported: exported, allowCleartext: cleartext },
            });
            results.push({ ...item, status: "done", result });
          } catch (reason) {
            results.push({ ...item, status: "failed", error: String(reason) });
          }
          setBatchResults([...results]);
        }
        setBatchInstallSelection(results.filter((item) => item.status === "done").map((item) => item.result.outputPath));
        setStatus("done");
        await refreshDevices();
        return;
      }
      if (!outputPath) throw new Error(language === "zh" ? "请先选择输出位置" : "Choose an output location first");
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

  const toggleBatchInstall = (path) => {
    setBatchInstallSelection((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path]);
  };

  const installBatchToDevice = async () => {
    const device = devices.find((item) => item.serial === selectedSerial && item.status === "device");
    if (!device || !batchInstallSelection.length) return;
    setBatchInstalling(true);
    setDeviceStatus("");
    setBatchInstallResults({});
    const results = {};
    let installed = 0;
    for (const path of batchInstallSelection) {
      try {
        await invoke("install_apk", { serial: device.serial, path });
        results[path] = { status: "done" };
        installed += 1;
      } catch (reason) {
        results[path] = { status: "failed", error: String(reason) };
      }
      setBatchInstallResults({ ...results });
    }
    setBatchInstalling(false);
    setDeviceStatus(language === "zh" ? `已安装 ${installed}/${batchInstallSelection.length} 个 APK 到 ${device.model}` : `Installed ${installed}/${batchInstallSelection.length} APKs on ${device.model}`);
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
      await invoke("reveal_path", { path: isBatch ? batchOutputDir : repairResult.outputPath });
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
    <main className={`app${isMacOS ? " macos" : ""}`}>
      <header className="app-bar" data-tauri-drag-region>
        <div className="brand">
          <span className="brand-icon"><img src={appIcon} alt="" /></span>
          <div><strong>APK Compat Helper</strong><small>{copy.subtitle}</small></div>
        </div>
        <button className="icon-button" aria-label={copy.settings} onClick={() => setSettingsOpen(true)}><GearSix /></button>
      </header>

      {firstLaunch && <LanguageDialog language={language} setLanguage={changeLanguage} copy={copy} onConfirm={confirmLanguage} />}
      {settingsOpen && <SettingsDialog language={language} setLanguage={changeLanguage} theme={theme} setTheme={setTheme} copy={copy} version={appVersion} onClose={() => setSettingsOpen(false)} />}
      {riskReport && <RiskDialog report={riskReport} language={language} findingCopy={findingCopy} findingSummaryCopy={findingSummaryCopy} onClose={() => setRiskReport(null)} />}

      <section className="tool-card">
        {status === "confirm" ? (
          <div className="process-page confirm-page">
            <span className="process-icon confirm-icon"><Wrench weight="fill" /></span>
            <p className="step-label">{language === "zh" ? "第 2 步, 确认并修复" : "Step 2, confirm and repair"}</p>
            <h1>{isBatch ? (language === "zh" ? `准备修复 ${batchItems.length} 个 APK` : `Ready to repair ${batchItems.length} APKs`) : (language === "zh" ? "确认修复设置" : "Confirm repair settings")}</h1>
            <p>{language === "zh" ? "选择结果保存位置, 确认后开始修复. 原 APK不会被覆盖." : "Choose where to save the results, then start repair. Original APKs are never overwritten."}</p>
            <div className="output-row confirm-output"><span><strong>{copy.output}</strong><small>{isBatch ? (language === "zh" ? "所有结果统一保存到此目录" : "All results are saved in this folder") : (language === "zh" ? "默认保存在原 APK 所在目录的“修复结果”文件夹" : "Saved in the Repaired APKs folder next to the source APK")}</small></span><button onClick={chooseOutput}><FolderOpen />{copy.change}</button><code>{isBatch ? batchOutputDir : outputPath}</code></div>
            <button className="primary-button" onClick={startRepair}>{language === "zh" ? "开始修复" : "Start repair"} <ArrowRight weight="bold" /></button>
            <button className="secondary-button" onClick={() => setStatus("ready")}>{language === "zh" ? "返回检查" : "Back to review"}</button>
          </div>
        ) : status === "repairing" ? (
          <div className="process-page">
            <span className="process-icon working-icon"><CircleNotch weight="bold" /></span>
            <p className="step-label">{language === "zh" ? "第 2 步, 正在修复" : "Step 2, repairing"}</p>
            <h1>{isBatch ? (language === "zh" ? `正在修复 ${batchIndex + 1}/${batchItems.length}` : `Repairing ${batchIndex + 1}/${batchItems.length}`) : stage[1][language === "zh" ? 0 : 1]}</h1>
            <p>{language === "zh" ? "程序仍可正常响应, 请不要移动原 APK 或关闭应用." : "The app remains responsive. Do not move the source APK or close the app."}</p>
            <div className="progress-track"><i style={{ width: `${progressStages[progressStage]?.[0] ?? 5}%` }} /></div>
            <div className="progress-meta"><span>{stage[1][language === "zh" ? 0 : 1]}</span><span>{isBatch ? batchItems[batchIndex]?.report?.fileName : report.fileName}</span></div>
            {isBatch && <BatchProgress items={batchItems} results={batchResults} activeIndex={batchIndex} language={language} />}
            <div className="output-preview"><span>{copy.output}</span><strong>{isBatch ? batchOutputDir : outputPath}</strong></div>
          </div>
        ) : status === "done" && (repairResult || isBatch) ? (
          <div className="result-page">
            <span className={`result-check ${isBatch && !batchResults.some((item) => item.status === "done") ? "failed" : ""}`}>{isBatch && !batchResults.some((item) => item.status === "done") ? <Warning weight="fill" /> : <Check weight="bold" />}</span>
            <p className="step-label">{copy.step3}</p>
            <h1>{isBatch ? (language === "zh" ? `已完成 ${batchResults.filter((item) => item.status === "done").length}/${batchItems.length} 个 APK` : `${batchResults.filter((item) => item.status === "done").length}/${batchItems.length} APKs completed`) : copy.done}</h1>
            <p>{isBatch ? (language === "zh" ? "每个 APK 独立处理, 单个失败不会影响其他文件." : "Each APK is processed independently. One failure does not stop the rest.") : (language === "zh" ? "签名和 ZIP 对齐验证均已通过, 输出目录只保留最终 APK." : "Signing and ZIP alignment passed. Only the final APK is kept in the output folder.")}</p>
            {isBatch ? <BatchProgress items={batchItems} results={batchResults} activeIndex={-1} language={language} showErrors errorSummary={errorSummary} installSelection={batchInstallSelection} installResults={batchInstallResults} onToggleInstall={toggleBatchInstall} installDisabled={batchInstalling} /> : <div className="result-files"><span>{language === "zh" ? "新 APK" : "New APK"}</span><strong>{repairResult.outputPath}</strong></div>}
            <div className="result-actions">
              <button className="primary-button" onClick={revealOutput}><FolderOpen />{copy.openFolder}</button>
              <button className="secondary-button" onClick={removeFile}>{copy.another}</button>
            </div>
            {(!isBatch || successfulBatchPaths.length > 0) && <AdbPanel language={language} copy={copy} devices={devices} selectedSerial={selectedSerial} setSelectedSerial={setSelectedSerial} devicesLoading={devicesLoading} refreshDevices={refreshDevices} install={isBatch ? installBatchToDevice : installToDevice} installing={isBatch ? batchInstalling : deviceStatus === "installing"} deviceStatus={deviceStatus} selectedCount={isBatch ? batchInstallSelection.length : 1} totalCount={isBatch ? successfulBatchPaths.length : 1} selectAll={() => setBatchInstallSelection(successfulBatchPaths)} clearSelection={() => setBatchInstallSelection([])} batch={isBatch} />}
          </div>
        ) : (
        <>
        <div className="intro">
          <p className="step-label">{copy.step1}</p>
          <h1>{copy.title}</h1>
          <p>{copy.privacy}</p>
        </div>

        {isBatch ? (
          <div className="batch-card">
            <div className="batch-heading"><span><strong>{language === "zh" ? `已选择 ${batchItems.length} 个 APK` : `${batchItems.length} APKs selected`}</strong><small>{language === "zh" ? "将按顺序处理, 可单独调整目标版本" : "Processed in order. Target versions can be adjusted individually."}</small></span><button className="remove-button" aria-label={language === "zh" ? "清空列表" : "Clear list"} onClick={removeFile}><X /></button></div>
            <div className="batch-list">
              {batchItems.map((item, index) => (
                <div className="batch-item" key={item.report?.sourcePath ?? item.path}>
                  <span className={`batch-state ${item.report?.supportLevel ?? "failed"}`}>{item.report ? <AndroidLogo weight="fill" /> : <Warning weight="fill" />}</span>
                  <span className="batch-file"><strong>{item.report?.fileName ?? item.fileName}</strong><small>{item.report ? `${formatSize(item.report.fileSize)} · ${item.report.targetBeforeDeclared ? `targetSDK ${item.report.targetBefore}` : language === "zh" ? "targetSDK 未声明" : "targetSDK not declared"}` : item.error}</small></span>
                  {item.report && <span className="select-control compact"><select aria-label={`${item.report.fileName} targetSDK`} value={item.target} onChange={(event) => setBatchItems((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, target: Number(event.target.value) } : entry))}>{item.report.androidVersions.map((version) => <option value={version.api} key={version.api}>API {version.api} · Android {version.android}</option>)}</select><CaretDown weight="bold" /></span>}
                  {item.report?.findings.length ? <button className={`batch-risk ${item.report.supportLevel}`} onClick={() => setRiskReport(item.report)}>{item.report.findings.length} {language === "zh" ? "项风险" : "risks"}<ArrowRight weight="bold" /></button> : <span className={`batch-risk ${item.report?.supportLevel ?? "failed"}`}>{item.report ? (language === "zh" ? "可直接修复" : "Ready") : (language === "zh" ? "解析失败" : "Failed")}</span>}
                  <button className="remove-button" aria-label={language === "zh" ? `移除 ${item.report?.fileName ?? item.fileName}` : `Remove ${item.report?.fileName ?? item.fileName}`} onClick={() => removeBatchItem(index)}><X /></button>
                </div>
              ))}
            </div>
          </div>
        ) : report ? (
          <div className="file-row">
            <span className="file-icon"><AndroidLogo weight="fill" /></span>
            <div className="file-copy">
              <strong>{report.fileName}</strong>
              <span>{formatSize(report.fileSize)} · {report.targetBeforeDeclared ? `targetSDK ${report.targetBefore}` : (language === "zh" ? "targetSDK 未声明" : "targetSDK not declared")} · Android APK</span>
            </div>
              <span className="scan-status"><Check weight="bold" /> {copy.parsed}</span>
            <button className="remove-button" aria-label={language === "zh" ? "移除 APK" : "Remove APK"} onClick={removeFile}><X /></button>
          </div>
        ) : (
          <button className={`drop-zone ${status === "scanning" ? "loading" : ""}`} onClick={chooseFile} disabled={status === "scanning"}>
            <FileArrowUp />
            <strong>{status === "scanning" ? copy.scanning : copy.drop}</strong>
            <span>{language === "zh" ? "支持同时选择多个 .apk 文件" : "Select multiple .apk files at once"}</span>
          </button>
        )}

        {error && <div className="error-line"><Warning weight="fill" /><span><strong>{copy.failed}</strong>{errorSummary(error)}<TechnicalDetails error={error} language={language} /></span></div>}

        {report && !isBatch && (
          <>
            <div className={`result-line ${report.supportLevel}`}>
              <span className="result-icon"><ShieldCheck weight="fill" /></span>
              <div>
                <strong>{summaryCopy}</strong>
                <p>{topFinding ? (language === "zh" ? `检测到 ${report.findings.length} 项需要确认的兼容风险, 仍允许继续修复.` : `${report.findings.length} compatibility finding${report.findings.length === 1 ? "" : "s"} require review. Repair can continue.`) : (language === "zh" ? "未发现会阻止继续处理的明显兼容问题." : "No obvious issue prevents continuing.")}</p>
              </div>
              {report.findings.length > 0 && <button className="risk-detail-button" onClick={() => setRiskReport(report)}>{language === "zh" ? "查看详情" : "View details"}<ArrowRight weight="bold" /></button>}
            </div>

            <div className="parameter-compare" aria-label={language === "zh" ? "修改前后参数对比" : "Before and after comparison"}>
              <div>
                <span>{copy.before}</span>
                <strong>{report.targetBeforeDeclared ? `targetSDK ${report.targetBefore}` : (language === "zh" ? "targetSDK 未声明" : "targetSDK not declared")}</strong>
                <small>{report.targetBeforeDeclared ? `Android ${report.targetBeforeAndroidVersion}` : (language === "zh" ? `系统按 API ${report.targetBefore} · Android ${report.targetBeforeAndroidVersion} 处理` : `Treated as API ${report.targetBefore} · Android ${report.targetBeforeAndroidVersion}`)}</small>
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
                <Option checked={exported} onChange={setExported} title={language === "zh" ? "补充组件导出声明" : "Add component export declarations"} description={language === "zh" ? "仅修改语义明确的主入口" : "Only updates unambiguous launcher components"} />
                <Option checked={cleartext} onChange={setCleartext} title={language === "zh" ? "允许明文 HTTP" : "Allow cleartext HTTP"} description={language === "zh" ? "存在安全风险, 默认关闭" : "Security risk, disabled by default"} warning />
              </div>
            )}

            <div className="primary-area">
              <button className="primary-button" onClick={startRepair}>{language === "zh" ? "下一步" : "Next"} <ArrowRight weight="bold" /></button>
              <p>{language === "zh" ? "下一步确认输出位置后开始修复" : "Confirm the output location on the next step"}</p>
            </div>
          </>
        )}
        {isBatch && status === "ready" && <div className="primary-area"><button className="primary-button" onClick={startRepair} disabled={!batchItems.some((item) => item.report)}>{language === "zh" ? `下一步, 修复 ${batchItems.filter((item) => item.report).length} 个 APK` : `Next, repair ${batchItems.filter((item) => item.report).length} APKs`} <ArrowRight weight="bold" /></button><p>{language === "zh" ? "下一步确认统一输出目录" : "Confirm the shared output folder on the next step"}</p></div>}
        </>
        )}
      </section>

      <footer className="flow-note">
        <span className={report || isBatch ? "" : "active"}>1 {language === "zh" ? "选择 APK" : "Choose APKs"}</span><i /><span className={status === "confirm" || status === "repairing" ? "active" : ""}>2 {language === "zh" ? "自动修复" : "Repair"}</span><i /><span className={status === "done" ? "active" : ""}>3 {language === "zh" ? "获取新 APK" : "Get APKs"}</span>
      </footer>
    </main>
  );
}

function BatchProgress({ items, results, activeIndex, language, showErrors = false, errorSummary, installSelection, installResults = {}, onToggleInstall, installDisabled = false }) {
  const installMode = Array.isArray(installSelection);
  return <div className="batch-progress">{items.map((item, index) => {
    const result = results[index];
    const state = result?.status ?? (index === activeIndex ? "working" : index < activeIndex ? "done" : "waiting");
    const outputPath = result?.result?.outputPath;
    const installResult = outputPath ? installResults[outputPath] : null;
    const hasError = showErrors && (result?.error || installResult?.error);
    const stateText = state === "working" ? (language === "zh" ? "处理中" : "Processing") : state === "done" ? (language === "zh" ? "已完成" : "Done") : state === "failed" ? (language === "zh" ? "失败" : "Failed") : (language === "zh" ? "等待" : "Waiting");
    const installText = installResult?.status === "done" ? (language === "zh" ? "已安装" : "Installed") : installResult?.status === "failed" ? (language === "zh" ? "安装失败" : "Install failed") : installSelection?.includes(outputPath) ? (language === "zh" ? "待安装" : "Ready to install") : (language === "zh" ? "不安装" : "Skip");
    return <div className={`batch-progress-item ${hasError ? "has-error" : ""}`} key={item.report?.sourcePath ?? item.path}>
      <span className={`progress-dot ${state}`}>{state === "done" ? <Check weight="bold" /> : state === "failed" ? <X weight="bold" /> : index + 1}</span>
      <span><strong>{item.report?.fileName ?? item.fileName}</strong>{showErrors && result?.error && <><small>{errorSummary(result.error)}</small><TechnicalDetails error={result.error} language={language} /></>}{installResult?.error && <><small>{language === "zh" ? "安装失败, 可查看技术详情后重试." : "Installation failed. Review the details and retry."}</small><TechnicalDetails error={installResult.error} language={language} /></>}</span>
      {installMode && outputPath ? <label className={`batch-install-choice ${installResult?.status ?? ""}`}><input type="checkbox" aria-label={`${item.report?.fileName ?? item.fileName}: ${language === "zh" ? "选择安装" : "Select for installation"}`} checked={installSelection.includes(outputPath)} onChange={() => onToggleInstall(outputPath)} disabled={installDisabled} /><span>{installText}</span></label> : !hasError && <em>{stateText}</em>}
    </div>;
  })}</div>;
}

function AdbPanel({ language, copy, devices, selectedSerial, setSelectedSerial, devicesLoading, refreshDevices, install, installing, deviceStatus, selectedCount, totalCount, selectAll, clearSelection, batch }) {
  return <section className="adb-panel">
    <div className="adb-heading">
      <span><DeviceMobile weight="fill" /><span><strong>{copy.adb}</strong><small>{batch ? copy.batchInstallHint : (language === "zh" ? "连接 USB 并开启 USB 调试" : "Connect USB and enable USB debugging")}</small></span></span>
      <button onClick={refreshDevices} disabled={devicesLoading || installing}><ArrowClockwise className={devicesLoading ? "spinning" : ""} />{devicesLoading ? (language === "zh" ? "正在刷新" : "Refreshing") : copy.refresh}</button>
    </div>
    {batch && <div className="batch-install-toolbar"><span>{copy.selectedForInstall} {selectedCount}/{totalCount}</span><span><button onClick={selectAll} disabled={installing || selectedCount === totalCount}>{copy.selectAll}</button><button onClick={clearSelection} disabled={installing || selectedCount === 0}>{copy.clearSelection}</button></span></div>}
    {devices.length > 0 ? <div className="device-picker">
      <label htmlFor="device-select">{language === "zh" ? "选择设备" : "Choose device"}</label>
      <span className="select-control"><select id="device-select" value={selectedSerial} onChange={(event) => setSelectedSerial(event.target.value)} disabled={installing}><option value="">{language === "zh" ? "请选择已授权设备" : "Choose an authorized device"}</option>{devices.map((device) => <option key={device.serial} value={device.status === "device" ? device.serial : ""}>{device.model} · {device.status === "device" ? (language === "zh" ? "已连接" : "Connected") : device.status === "unauthorized" ? (language === "zh" ? "等待授权" : "Authorization required") : (language === "zh" ? "不可用" : "Unavailable")}</option>)}</select><CaretDown weight="bold" /></span>
    </div> : <div className="device-empty">{language === "zh" ? "未检测到设备. 连接后点击刷新设备." : "No device found. Connect one, then refresh."}</div>}
    <button className="install-button" onClick={install} disabled={!selectedSerial || installing || selectedCount === 0}>{installing ? (batch ? (language === "zh" ? "正在依次安装..." : "Installing selected APKs...") : (language === "zh" ? "正在安装 APK..." : "Installing APK...")) : batch ? `${copy.installSelected} (${selectedCount})` : copy.install}</button>
    {deviceStatus && deviceStatus !== "installing" && <p className="device-status">{deviceStatus}</p>}
  </section>;
}

function TechnicalDetails({ error, language }) {
  return <details className="technical-details"><summary>{language === "zh" ? "技术详情" : "Technical details"}</summary><pre>{error}</pre></details>;
}

function RiskDialog({ report, language, findingCopy, findingSummaryCopy, onClose }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="risk-dialog" role="dialog" aria-modal="true" aria-labelledby="risk-title"><header><span className="risk-dialog-icon"><Warning weight="fill" /></span><span><small>{language === "zh" ? "兼容性检查" : "Compatibility check"}</small><h2 id="risk-title">{report.fileName}</h2></span><button className="remove-button" onClick={onClose} aria-label={language === "zh" ? "关闭风险详情" : "Close risk details"}><X /></button></header><p className="risk-intro">{language === "zh" ? `检测到 ${report.findings.length} 项风险. 这些问题不会阻止修复, 但相关功能可能需要真机验证.` : `${report.findings.length} risk${report.findings.length === 1 ? "" : "s"} found. Repair can continue, but affected features may require device testing.`}</p><div className="risk-dialog-list">{report.findings.map((finding) => <section key={finding.id}><strong>{findingCopy(finding)}</strong><p>{findingSummaryCopy(finding)}</p>{finding.permissionDetails?.length > 0 && <div className="risk-permissions">{finding.permissionDetails.map((permission) => <div key={permission.name}><span><b>{language === "zh" ? permission.label : permission.labelEn}</b><code>{permission.name}</code></span><p>{language === "zh" ? permission.description : permission.descriptionEn}</p></div>)}</div>}</section>)}</div><footer><button className="primary-button" onClick={onClose}>{language === "zh" ? "我知道了" : "Got it"}</button></footer></section></div>;
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
  return <div className="modal-backdrop"><section className="setup-dialog" role="dialog" aria-modal="true"><span className="setup-mark"><img src={appIcon} alt="" /></span><h2>{copy.firstTitle}</h2><p>{copy.firstBody}</p><div className="language-options"><button className={language === "zh" ? "selected" : ""} onClick={() => setLanguage("zh")}>简体中文</button><button className={language === "en" ? "selected" : ""} onClick={() => setLanguage("en")}>English</button></div><button className="primary-button" onClick={onConfirm}>{copy.confirm}<ArrowRight weight="bold" /></button></section></div>;
}

function SettingsDialog({ language, setLanguage, theme, setTheme, copy, version, onClose }) {
  return <div className="settings-backdrop"><aside className="settings-sheet" role="dialog" aria-modal="true"><header className="settings-sheet-head"><div><span>{copy.settings}</span><h2>APK Compat Helper</h2></div><button className="remove-button" onClick={onClose} aria-label={copy.close}><X /></button></header><div className="settings-content"><section className="settings-group"><p>{copy.language}</p><div className="setting-segments language-segments"><button className={language === "zh" ? "selected" : ""} onClick={() => setLanguage("zh")}>简体中文</button><button className={language === "en" ? "selected" : ""} onClick={() => setLanguage("en")}>English</button></div></section><section className="settings-group"><p>{copy.theme}</p><div className="setting-segments theme-segments"><button className={theme === "system" ? "selected" : ""} onClick={() => setTheme("system")}><Desktop />{copy.system}</button><button className={theme === "light" ? "selected" : ""} onClick={() => setTheme("light")}><Sun />{copy.light}</button><button className={theme === "dark" ? "selected" : ""} onClick={() => setTheme("dark")}><Moon />{copy.dark}</button></div></section><section className="about-card"><span className="brand-icon"><img src={appIcon} alt="" /></span><div><strong>APK Compat Helper</strong><small>{copy.version} {version}</small><small>{copy.subtitle}</small></div></section></div><footer className="settings-footer"><span>Local only · Tauri</span><button onClick={onClose}>{copy.close}</button></footer></aside></div>;
}

export default App;
