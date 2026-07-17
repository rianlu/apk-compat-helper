use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    env,
    error::Error,
    fs::{self, File},
    io::{BufReader, Read},
    path::{Path, PathBuf},
    process::Command,
};
use zip::ZipArchive;

// Keep a high safety ceiling without rejecting ordinary large games and media-heavy apps.
const MAX_APK_SIZE: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 100_000;
const MAX_UNCOMPRESSED_SIZE: u64 = 8 * 1024 * 1024 * 1024;
const MAX_INSPECTED_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Deserialize)]
struct Catalog {
    android_versions: Vec<AndroidVersion>,
    permissions: Vec<PermissionMeta>,
}

#[derive(Debug, Deserialize, Serialize)]
struct AndroidVersion {
    api: u32,
    android: String,
}

#[derive(Debug, Deserialize)]
struct PermissionMeta {
    name: String,
    label: String,
    label_en: String,
    description: String,
    description_en: String,
    protection: String,
    runtime_since: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    id: String,
    level: String,
    title: String,
    summary: String,
    evidence: Vec<String>,
    permission_details: Vec<PermissionDetail>,
    can_continue: bool,
    auto_fix: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionDetail {
    name: String,
    label: String,
    label_en: String,
    description: String,
    description_en: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    source_path: String,
    file_name: String,
    file_size: u64,
    sha256: String,
    package_name: String,
    app_name: String,
    version_name: String,
    version_code: String,
    min_sdk: Option<u32>,
    pub(crate) target_before: Option<u32>,
    target_before_declared: bool,
    target_before_android_version: String,
    target_after: u32,
    target_android_version: String,
    apk_type: String,
    dex_count: usize,
    native_libraries: Vec<String>,
    permissions: Vec<String>,
    android_versions: Vec<AndroidVersion>,
    findings: Vec<Finding>,
    support_level: String,
    can_continue: bool,
    summary: String,
    suggested_output_path: String,
}

struct ZipFacts {
    dex_count: usize,
    native_libraries: Vec<String>,
    has_http: bool,
    has_permission_request_code: bool,
}

pub fn scan(path: &str, requested_target: Option<u32>) -> Result<ScanReport, Box<dyn Error>> {
    let source = Path::new(path);
    if source.extension().and_then(|value| value.to_str()) != Some("apk") {
        return Err("请选择 .apk 文件".into());
    }

    let metadata = fs::metadata(source)?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("APK 文件不存在或为空".into());
    }
    if metadata.len() > MAX_APK_SIZE {
        return Err("APK 超过 2 GB 安全上限".into());
    }

    let sha256 = file_sha256(source)?;
    let zip_facts = inspect_zip(source)?;
    let badging = read_badging(source)?;
    let catalog: Catalog =
        serde_json::from_str(include_str!("../resources/compatibility-catalog.json"))?;

    let declared_target = badging
        .get("targetSdkVersion")
        .and_then(|value| value.parse::<u32>().ok());
    let min_sdk = badging
        .get("minSdkVersion")
        .and_then(|value| value.parse::<u32>().ok());
    let target_before = Some(declared_target.or(min_sdk).unwrap_or(1));
    let latest_target = catalog
        .android_versions
        .iter()
        .map(|version| version.api)
        .max()
        .unwrap_or(36);
    let target_after = requested_target.unwrap_or(latest_target);
    let permission_map: HashMap<&str, &PermissionMeta> = catalog
        .permissions
        .iter()
        .map(|permission| (permission.name.as_str(), permission))
        .collect();

    let permissions: Vec<String> = badging
        .get("permissions")
        .map(|value| {
            value
                .split('\n')
                .filter(|item| !item.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let mut findings = Vec::new();

    let runtime_permissions: Vec<&PermissionMeta> = permissions
        .iter()
        .filter_map(|name| permission_map.get(name.as_str()).copied())
        .filter(|permission| {
            permission.protection == "dangerous"
                && permission
                    .runtime_since
                    .is_some_and(|api| target_after >= api)
        })
        .collect();

    if !runtime_permissions.is_empty() && !zip_facts.has_permission_request_code {
        let labels = runtime_permissions
            .iter()
            .map(|permission| permission.label.as_str())
            .collect::<Vec<_>>()
            .join("、");
        findings.push(Finding {
            id: "runtime_permission_missing".into(),
            level: "experimental".into(),
            title: "可能缺少运行时权限申请".into(),
            summary: format!(
                "检测到{labels}权限, 未在 APK 中检测到常见的运行时权限申请特征, 但无法确认实际代码路径. 提升到 targetSDK {target_after} 后相关功能可能失效, 仍允许继续修复."
            ),
            evidence: runtime_permissions
                .iter()
                .map(|permission| format!("{} ({})", permission.label, permission.name))
                .collect(),
            permission_details: runtime_permissions
                .iter()
                .map(|permission| PermissionDetail {
                    name: permission.name.clone(),
                    label: permission.label.clone(),
                    label_en: permission.label_en.clone(),
                    description: permission.description.clone(),
                    description_en: permission.description_en.clone(),
                })
                .collect(),
            can_continue: true,
            auto_fix: false,
        });
    }

    if !zip_facts.native_libraries.is_empty() {
        findings.push(Finding {
            id: "native_libraries".into(),
            level: "experimental".into(),
            title: "包含原生库".into(),
            summary: "本工具不会修改原生代码, 输出结果需要设备验证.".into(),
            evidence: zip_facts.native_libraries.clone(),
            permission_details: Vec::new(),
            can_continue: true,
            auto_fix: false,
        });
    }

    if target_after >= 28 && zip_facts.has_http {
        findings.push(Finding {
            id: "cleartext_http".into(),
            level: "warning".into(),
            title: "发现明文 HTTP 地址".into(),
            summary: "相关网络功能可能在 Android 9及以上受到限制.".into(),
            evidence: vec!["APK 资源或代码中包含 http://".into()],
            permission_details: Vec::new(),
            can_continue: true,
            auto_fix: false,
        });
    }

    let support_level = if findings
        .iter()
        .any(|finding| finding.level == "experimental")
    {
        "experimental"
    } else if findings.iter().any(|finding| finding.level == "warning") {
        "risk"
    } else {
        "recommended"
    };
    let summary = match support_level {
        "experimental" => "检测到需要确认的兼容风险, 仍可继续修复.",
        "risk" => "可以自动修复, 请留意兼容风险.",
        _ => "可以尝试自动修复.",
    };
    let package_name = badging
        .get("package")
        .cloned()
        .unwrap_or_else(|| "未知包名".into());
    let apk_type = classify_apk(&package_name, &zip_facts);

    Ok(ScanReport {
        source_path: source.display().to_string(),
        file_name: source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("unknown.apk")
            .into(),
        file_size: metadata.len(),
        sha256,
        package_name,
        app_name: badging
            .get("application-label")
            .cloned()
            .unwrap_or_else(|| "未知应用".into()),
        version_name: badging.get("versionName").cloned().unwrap_or_default(),
        version_code: badging.get("versionCode").cloned().unwrap_or_default(),
        min_sdk,
        target_before,
        target_before_declared: declared_target.is_some(),
        target_before_android_version: android_version(&catalog, target_before.unwrap_or(1)),
        target_after,
        target_android_version: catalog
            .android_versions
            .iter()
            .find(|version| version.api == target_after)
            .map(|version| version.android.clone())
            .unwrap_or_else(|| format!("API {target_after}")),
        apk_type,
        dex_count: zip_facts.dex_count,
        native_libraries: zip_facts.native_libraries,
        permissions,
        android_versions: catalog.android_versions,
        findings,
        support_level: support_level.into(),
        can_continue: true,
        summary: summary.into(),
        suggested_output_path: suggested_output_path(source),
    })
}

fn android_version(catalog: &Catalog, api: u32) -> String {
    catalog
        .android_versions
        .iter()
        .find(|version| version.api == api)
        .map(|version| version.android.clone())
        .unwrap_or_else(|| format!("API {api}"))
}

fn suggested_output_path(source: &Path) -> String {
    let parent = source.parent().unwrap_or_else(|| Path::new("."));
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("output");
    (1..)
        .map(|index| {
            let suffix = if index == 1 {
                "_compat".into()
            } else {
                format!("_compat_{index}")
            };
            parent.join(format!("{stem}{suffix}.apk"))
        })
        .find(|path| !path.exists())
        .unwrap()
        .display()
        .to_string()
}

fn file_sha256(path: &Path) -> Result<String, Box<dyn Error>> {
    let mut reader = BufReader::new(File::open(path)?);
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(hex::encode(digest.finalize()))
}

fn inspect_zip(path: &Path) -> Result<ZipFacts, Box<dyn Error>> {
    let mut archive = ZipArchive::new(File::open(path)?)?;
    if archive.len() > MAX_ENTRIES {
        return Err("APK 文件条目数量超过安全上限".into());
    }

    let mut total_size = 0u64;
    let mut inspected_size = 0u64;
    let mut dex_count = 0usize;
    let mut native_libraries = Vec::new();
    let mut has_http = false;
    let mut has_permission_request_code = false;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let name = entry.name().to_owned();
        if entry.enclosed_name().is_none() {
            return Err(format!("APK 包含危险路径: {name}").into());
        }
        total_size = total_size.saturating_add(entry.size());
        if total_size > MAX_UNCOMPRESSED_SIZE {
            return Err("APK 解压后预计体积超过安全上限".into());
        }

        if name.starts_with("classes") && name.ends_with(".dex") {
            dex_count += 1;
        }
        if name.starts_with("lib/") && name.ends_with(".so") {
            native_libraries.push(name.clone());
        }

        let inspect = name.ends_with(".dex")
            || name == "resources.arsc"
            || name.starts_with("assets/")
            || name.starts_with("res/xml/");
        if inspect && entry.size() <= 20 * 1024 * 1024 && inspected_size < MAX_INSPECTED_BYTES {
            let remaining = (MAX_INSPECTED_BYTES - inspected_size).min(entry.size());
            let mut bytes = Vec::with_capacity(remaining as usize);
            entry.by_ref().take(remaining).read_to_end(&mut bytes)?;
            inspected_size += bytes.len() as u64;
            has_http |= contains_bytes(&bytes, b"http://");
            has_permission_request_code |= contains_bytes(&bytes, b"requestPermissions")
                || contains_bytes(&bytes, b"checkSelfPermission")
                || contains_bytes(&bytes, b"RequestPermission");
        }
    }

    if archive.by_name("AndroidManifest.xml").is_err() {
        return Err("APK 缺少 AndroidManifest.xml".into());
    }

    Ok(ZipFacts {
        dex_count,
        native_libraries,
        has_http,
        has_permission_request_code,
    })
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

fn read_badging(path: &Path) -> Result<HashMap<String, String>, Box<dyn Error>> {
    let aapt2 = find_aapt2().ok_or("未找到内置或本机 aapt2")?;
    let output = Command::new(aapt2)
        .args(["dump", "badging"])
        .arg(path)
        .output()?;
    if !output.status.success() {
        return Err(format!(
            "aapt2 解析失败: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
        .into());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut values = HashMap::new();
    let mut permissions = Vec::new();
    for line in text.lines() {
        if line.starts_with("package:") {
            for key in ["name", "versionCode", "versionName"] {
                if let Some(value) = quoted_value(line, key, '=') {
                    values.insert(if key == "name" { "package" } else { key }.into(), value);
                }
            }
        } else if line.starts_with("minSdkVersion:") {
            if let Some(value) = quoted_value(line, "minSdkVersion", ':') {
                values.insert("minSdkVersion".into(), value);
            }
        } else if line.starts_with("targetSdkVersion:") {
            if let Some(value) = quoted_value(line, "targetSdkVersion", ':') {
                values.insert("targetSdkVersion".into(), value);
            }
        } else if line.starts_with("application-label:") {
            if let Some(value) = quoted_value(line, "application-label", ':') {
                values.insert("application-label".into(), value);
            }
        } else if line.starts_with("uses-permission:") {
            if let Some(value) = quoted_value(line, "name", '=') {
                permissions.push(value);
            }
        }
    }
    values.insert("permissions".into(), permissions.join("\n"));
    Ok(values)
}

fn quoted_value(line: &str, key: &str, separator: char) -> Option<String> {
    let prefix = format!("{key}{separator}'");
    let start = line.find(&prefix)? + prefix.len();
    let end = line[start..].find('\'')? + start;
    Some(line[start..end].to_owned())
}

fn find_aapt2() -> Option<PathBuf> {
    find_android_tool("aapt2")
}

pub fn find_android_tool(name: &str) -> Option<PathBuf> {
    if let Some(path) = env::var_os("APK_COMPAT_TOOLS_DIR")
        .map(PathBuf::from)
        .map(|path| path.join(name))
        .filter(|path| path.is_file())
    {
        return Some(path);
    }
    if name == "aapt2" {
        if let Ok(path) = env::var("APK_COMPAT_AAPT2") {
            let path = PathBuf::from(path);
            if path.is_file() {
                return Some(path);
            }
        }
    }

    let sdk = env::var_os("ANDROID_HOME")
        .or_else(|| env::var_os("ANDROID_SDK_ROOT"))
        .map(PathBuf::from)
        .or_else(|| {
            env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Android/sdk"))
        })?;
    let build_tools = sdk.join("build-tools");
    let mut versions: Vec<(Vec<u32>, PathBuf)> = fs::read_dir(build_tools)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let version = entry
                .file_name()
                .to_string_lossy()
                .split('.')
                .map(str::parse)
                .collect::<Result<Vec<u32>, _>>()
                .ok()?;
            let executable = entry.path().join(name);
            executable.is_file().then_some((version, executable))
        })
        .collect();
    versions.sort_by(|left, right| left.0.cmp(&right.0));
    versions.pop().map(|(_, path)| path)
}

fn classify_apk(package_name: &str, facts: &ZipFacts) -> String {
    if package_name.contains(".theme.") || package_name.ends_with(".theme") {
        "主题插件".into()
    } else if !facts.native_libraries.is_empty() {
        "包含原生库的应用".into()
    } else {
        "普通 APK".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_latest_aapt2() {
        assert!(find_aapt2().is_some());
    }

    #[test]
    fn scans_theme_fixture() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../test/com.smartisanos.launcher.theme.aero.apk");
        let report = scan(path.to_str().unwrap(), Some(24)).unwrap();
        assert_eq!(report.package_name, "com.smartisanos.launcher.theme.aero");
        assert_eq!(report.target_before, Some(17));
        assert_eq!(report.target_after, 24);
        assert_eq!(report.apk_type, "主题插件");
    }

    #[test]
    fn explains_undeclared_sdk_and_permissions() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../test/blue-v1.1-vc2.apk");
        let report = scan(path.to_str().unwrap(), Some(24)).unwrap();
        assert_eq!(report.target_before, Some(1));
        assert!(!report.target_before_declared);
        assert!(report.findings[0].summary.contains("读取存储"));
        assert!(report.findings[0].summary.contains("电话状态"));
    }
}
