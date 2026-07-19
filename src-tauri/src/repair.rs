use serde::{Deserialize, Serialize};
use std::{
    env,
    error::Error,
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairOptions {
    pub target_sdk: u32,
    pub add_exported: bool,
    pub allow_cleartext: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairResult {
    output_path: String,
    report_json_path: String,
    report_markdown_path: String,
    changes: Vec<String>,
    signature_verified: bool,
    alignment_verified: bool,
}

#[cfg(test)]
pub fn repair(
    source: &str,
    output: &str,
    options: RepairOptions,
    data_dir: &Path,
) -> Result<RepairResult, Box<dyn Error>> {
    repair_with_progress(source, output, options, data_dir, |_| {})
}

pub fn repair_with_progress<F: Fn(&str)>(
    source: &str,
    output: &str,
    options: RepairOptions,
    data_dir: &Path,
    progress: F,
) -> Result<RepairResult, Box<dyn Error>> {
    progress("validating");
    let source = Path::new(source);
    let output = Path::new(output);
    if source == output {
        return Err("输出路径不能覆盖原 APK".into());
    }
    if output.exists() {
        return Err("输出文件已存在, 请更改文件名".into());
    }
    if output.extension().and_then(|value| value.to_str()) != Some("apk") {
        return Err("输出文件必须使用 .apk 扩展名".into());
    }
    let scan_before = super::scanner::scan(
        source.to_str().ok_or("APK 路径无效")?,
        Some(options.target_sdk),
    )?;

    let aapt2 = super::scanner::find_android_tool("aapt2").ok_or("未找到内置或本机 aapt2")?;
    let zipalign =
        super::scanner::find_android_tool("zipalign").ok_or("未找到内置或本机 zipalign")?;
    let keytool = bundled_path(
        "APK_COMPAT_TOOLS_DIR",
        &format!("runtime/bin/{}", platform_executable("keytool")),
    )
    .or_else(|| find_command("keytool"))
    .ok_or("未找到 keytool")?;

    let work = WorkDir::new()?;
    let decoded = work.path.join("decoded");
    let unsigned = work.path.join("unsigned.apk");
    let aligned = work.path.join("aligned.apk");

    progress("decoding");
    let decode_result = run(
        apktool_command()?
            .args(["d", "-f", "-s", "-o"])
            .arg(&decoded)
            .arg(source),
        "APK 解包失败",
    );

    let mut legacy_fallback = decode_result
        .as_ref()
        .err()
        .is_some_and(|error| is_legacy_resource_error(&error.to_string()));
    if let Err(error) = decode_result {
        if !legacy_fallback {
            return Err(error);
        }
        decode_legacy(source, &decoded)?;
    }

    progress("patching");
    let mut changes = patch_decoded(&decoded, &options)?;

    progress("building");
    if legacy_fallback {
        build_legacy(&decoded, &unsigned)?;
    } else if let Err(error) = run(
        apktool_command()?
            .arg("b")
            .arg(&decoded)
            .arg("--aapt")
            .arg(&aapt2)
            .arg("-o")
            .arg(&unsigned),
        "APK 重建失败",
    ) {
        if !is_legacy_resource_error(&error.to_string()) {
            return Err(error);
        }
        legacy_fallback = true;
        fs::remove_dir_all(&decoded)?;
        decode_legacy(source, &decoded)?;
        changes = patch_decoded(&decoded, &options)?;
        build_legacy(&decoded, &unsigned)?;
    }
    if legacy_fallback {
        changes.push("使用 Apktool 2 + AAPT1 旧版兼容链路".into());
    }
    progress("aligning");
    run(
        crate::background_command(&zipalign)
            .args(["-f", "4"])
            .arg(&unsigned)
            .arg(&aligned),
        "APK 对齐失败",
    )?;

    fs::create_dir_all(data_dir)?;
    let keystore = data_dir.join("local-signing.p12");
    if !keystore.exists() {
        run(
            crate::background_command(keytool)
                .args(["-genkeypair", "-storetype", "PKCS12", "-keystore"])
                .arg(&keystore)
                .args([
                    "-storepass",
                    "apk-compat-helper",
                    "-keypass",
                    "apk-compat-helper",
                    "-alias",
                    "apkcompat",
                    "-keyalg",
                    "RSA",
                    "-keysize",
                    "2048",
                    "-validity",
                    "10000",
                    "-dname",
                    "CN=APK Compat Helper,O=Local",
                ]),
            "本地签名证书生成失败",
        )?;
    }

    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    progress("signing");
    run(
        apksigner_command()?
            .arg("sign")
            .args(["--ks", keystore.to_str().ok_or("签名路径无效")?])
            .args([
                "--ks-key-alias",
                "apkcompat",
                "--ks-pass",
                "pass:apk-compat-helper",
            ])
            .args(["--v4-signing-enabled", "false"])
            .args(["--key-pass", "pass:apk-compat-helper", "--out"])
            .arg(output)
            .arg(&aligned),
        "APK 签名失败",
    )?;

    progress("verifying");
    run(
        apksigner_command()?
            .args(["verify", "--verbose"])
            .arg(output),
        "APK 签名验证失败",
    )?;
    run(
        crate::background_command(&zipalign)
            .args(["-c", "4"])
            .arg(output),
        "APK 对齐验证失败",
    )?;
    changes.push("使用本地证书重新签名".into());
    progress("reporting");
    let scan_after = super::scanner::scan(output.to_str().ok_or("输出路径无效")?, None)?;
    let reports_dir = data_dir.join("reports");
    fs::create_dir_all(&reports_dir)?;
    let report_name = output
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("repair");
    let report_json = reports_dir.join(format!("{report_name}.json"));
    let report_markdown = reports_dir.join(format!("{report_name}.md"));
    fs::write(
        &report_json,
        serde_json::to_string_pretty(&serde_json::json!({
            "status": "completed",
            "source": scan_before,
            "output": scan_after,
            "options": options,
            "changes": changes,
            "signatureVerified": true,
            "alignmentVerified": true
        }))?,
    )?;
    fs::write(
        &report_markdown,
        format!(
            "# APK Compat Helper 修复报告\n\n- 状态: 完成\n- 原文件: `{}`\n- 输出文件: `{}`\n- targetSDK: {}\n- 签名验证: 通过\n- ZIP 对齐验证: 通过\n\n## 修改项\n\n{}\n",
            source.display(),
            output.display(),
            options.target_sdk,
            changes
                .iter()
                .map(|change| format!("- {change}"))
                .collect::<Vec<_>>()
                .join("\n")
        ),
    )?;
    progress("completed");

    Ok(RepairResult {
        output_path: output.display().to_string(),
        report_json_path: report_json.display().to_string(),
        report_markdown_path: report_markdown.display().to_string(),
        changes,
        signature_verified: true,
        alignment_verified: true,
    })
}

fn patch_decoded(decoded: &Path, options: &RepairOptions) -> Result<Vec<String>, Box<dyn Error>> {
    let manifest_path = decoded.join("AndroidManifest.xml");
    let manifest = fs::read_to_string(&manifest_path)?;
    let (manifest, changes) = patch_manifest(manifest, options)?;
    fs::write(&manifest_path, manifest)?;
    let apktool_yml = decoded.join("apktool.yml");
    let metadata = fs::read_to_string(&apktool_yml)?;
    fs::write(
        &apktool_yml,
        set_yaml_value(&metadata, "  targetSdkVersion:", options.target_sdk),
    )?;
    Ok(changes)
}

fn decode_legacy(source: &Path, decoded: &Path) -> Result<(), Box<dyn Error>> {
    if decoded.exists() {
        fs::remove_dir_all(decoded)?;
    }
    run(
        apktool2_command()?
            .args(["d", "-f", "-s", "-o"])
            .arg(decoded)
            .arg(source),
        "APK 旧版兼容解包失败",
    )?;
    Ok(())
}

fn build_legacy(decoded: &Path, unsigned: &Path) -> Result<(), Box<dyn Error>> {
    let aapt = super::scanner::find_android_tool("aapt").ok_or("未找到内置或本机 aapt")?;
    run(
        apktool2_command()?
            .arg("b")
            .arg(decoded)
            .arg("-a")
            .arg(aapt)
            .arg("-o")
            .arg(unsigned),
        "APK 旧版兼容重建失败",
    )?;
    Ok(())
}

fn is_legacy_resource_error(message: &str) -> bool {
    [
        "Unresolved attr reference",
        "Could not decode attribute value",
        "Unexpected attribute name",
        "resources.arsc",
    ]
    .iter()
    .any(|marker| message.contains(marker))
        || (message.contains("attribute android:") && message.contains("not found"))
}

fn patch_manifest(
    mut manifest: String,
    options: &RepairOptions,
) -> Result<(String, Vec<String>), Box<dyn Error>> {
    let mut changes = Vec::new();
    manifest = set_attribute(
        &manifest,
        "<uses-sdk",
        "android:targetSdkVersion",
        &options.target_sdk.to_string(),
    )
    .or_else(|| insert_uses_sdk(&manifest, options.target_sdk))
    .ok_or("无法修改 targetSDK")?;
    changes.push(format!("targetSDK 修改为 {}", options.target_sdk));

    if options.allow_cleartext {
        manifest = set_attribute(
            &manifest,
            "<application",
            "android:usesCleartextTraffic",
            "true",
        )
        .ok_or("无法修改明文 HTTP 设置")?;
        changes.push("允许明文 HTTP".into());
    }
    if options.add_exported {
        if let Some(next) = patch_launcher_exported(&manifest) {
            manifest = next;
            changes.push("补充主入口 exported 声明".into());
        }
    }
    Ok((manifest, changes))
}

fn set_attribute(xml: &str, tag: &str, attribute: &str, value: &str) -> Option<String> {
    let start = xml.find(tag)?;
    let end = xml[start..].find('>')? + start;
    let opening = &xml[start..end];
    let replacement = if let Some(attribute_start) = opening.find(attribute) {
        let value_start = opening[attribute_start..].find('"')? + start + attribute_start + 1;
        let value_end = xml[value_start..].find('"')? + value_start;
        format!("{}{}{}", &xml[..value_start], value, &xml[value_end..])
    } else {
        format!("{} {}=\"{}\"{}", &xml[..end], attribute, value, &xml[end..])
    };
    Some(replacement)
}

fn insert_uses_sdk(xml: &str, target_sdk: u32) -> Option<String> {
    let manifest_start = xml.find("<manifest")?;
    let manifest_end = xml[manifest_start..].find('>')? + manifest_start + 1;
    Some(format!(
        "{}\n    <uses-sdk android:targetSdkVersion=\"{}\" />{}",
        &xml[..manifest_end],
        target_sdk,
        &xml[manifest_end..]
    ))
}

fn set_yaml_value(yaml: &str, key: &str, value: u32) -> String {
    let replacement = format!("{key} {value}");
    yaml.lines()
        .map(|line| {
            if line.starts_with(key) {
                replacement.as_str()
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

fn patch_launcher_exported(xml: &str) -> Option<String> {
    let main = xml.find("android.intent.action.MAIN")?;
    let activity = xml[..main].rfind("<activity")?;
    set_attribute_from(xml, activity, "android:exported", "true")
}

fn set_attribute_from(xml: &str, start: usize, attribute: &str, value: &str) -> Option<String> {
    let suffix = set_attribute(&xml[start..], "<activity", attribute, value)?;
    Some(format!("{}{}", &xml[..start], suffix))
}

fn find_command(name: &str) -> Option<PathBuf> {
    let executable = platform_executable(name);
    env::var_os("PATH")
        .and_then(|paths| {
            env::split_paths(&paths)
                .map(|path| path.join(&executable))
                .find(|path| path.is_file())
        })
        .or_else(|| {
            ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
                .iter()
                .map(|path| Path::new(path).join(&executable))
                .find(|path| path.is_file())
        })
}

fn bundled_path(root_variable: &str, path: &str) -> Option<PathBuf> {
    env::var_os(root_variable)
        .map(PathBuf::from)
        .or_else(|| {
            (root_variable == "APK_COMPAT_COMMON_TOOLS_DIR")
                .then(|| {
                    env::var_os("APK_COMPAT_TOOLS_DIR")
                        .map(PathBuf::from)
                        .and_then(|root| root.parent().map(|parent| parent.join("common")))
                })
                .flatten()
        })
        .map(|root| root.join(path))
        .filter(|path| path.is_file())
}

fn jar_command(jar: &str) -> Option<Command> {
    let java = bundled_path(
        "APK_COMPAT_TOOLS_DIR",
        &format!("runtime/bin/{}", platform_executable("java")),
    )
    .or_else(|| find_command("java"))?;
    let jar_path = bundled_path("APK_COMPAT_COMMON_TOOLS_DIR", jar)?;
    let mut command = crate::background_command(java);
    command
        .args([
            "-Duser.language=en",
            "-Duser.country=US",
            "-Dfile.encoding=UTF-8",
            "-jar",
        ])
        .arg(jar_path);
    Some(command)
}

fn platform_executable(name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{name}.exe")
    } else {
        name.to_owned()
    }
}

fn apktool_command() -> Result<Command, Box<dyn Error>> {
    jar_command("apktool.jar").ok_or_else(|| "未找到内置 apktool 或 Java Runtime".into())
}

fn apktool2_command() -> Result<Command, Box<dyn Error>> {
    jar_command("apktool2.jar").ok_or_else(|| "未找到内置 Apktool 2 或 Java Runtime".into())
}

fn apksigner_command() -> Result<Command, Box<dyn Error>> {
    jar_command("apksigner.jar").ok_or_else(|| "未找到内置 apksigner 或 Java Runtime".into())
}

fn run(command: &mut Command, message: &str) -> Result<Output, Box<dyn Error>> {
    let output = command.output()?;
    if !output.status.success() {
        let detail = [&output.stderr, &output.stdout]
            .into_iter()
            .map(|bytes| String::from_utf8_lossy(bytes).trim().to_owned())
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!("{message}: {detail}").into());
    }
    Ok(output)
}

struct WorkDir {
    path: PathBuf,
}

impl WorkDir {
    fn new() -> Result<Self, Box<dyn Error>> {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
        let path =
            env::temp_dir().join(format!("apk-compat-helper-{}-{stamp}", std::process::id()));
        fs::create_dir_all(&path)?;
        Ok(Self { path })
    }
}

impl Drop for WorkDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patches_manifest_options() {
        let xml = r#"<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-sdk android:targetSdkVersion="19"/><application><activity android:name=".Main"><intent-filter><action android:name="android.intent.action.MAIN"/></intent-filter></activity></application></manifest>"#;
        let (patched, changes) = patch_manifest(
            xml.into(),
            &RepairOptions {
                target_sdk: 24,
                add_exported: true,
                allow_cleartext: true,
            },
        )
        .unwrap();
        assert!(patched.contains("android:targetSdkVersion=\"24\""));
        assert!(patched.contains("android:usesCleartextTraffic=\"true\""));
        assert!(patched.contains("android:exported=\"true\""));
        assert_eq!(changes.len(), 3);
        assert!(insert_uses_sdk(
            "<?xml version=\"1.0\"?><manifest xmlns:android=\"x\"></manifest>",
            24
        )
        .unwrap()
        .contains("<manifest xmlns:android=\"x\">\n    <uses-sdk"));
    }

    #[test]
    fn classifies_only_legacy_resource_errors_for_fallback() {
        assert!(is_legacy_resource_error(
            "Unresolved attr reference: android:SecondaryProgress"
        ));
        assert!(is_legacy_resource_error(
            "error: attribute android:name not found"
        ));
        assert!(!is_legacy_resource_error("AAPT2 error: file not found"));
        assert!(!is_legacy_resource_error("APK 签名失败: invalid key"));
    }

    #[test]
    fn repairs_theme_fixture() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let source = root.join("test/com.smartisanos.launcher.theme.aero.apk");
        let work = WorkDir::new().unwrap();
        let output = work.path.join("repaired.apk");
        let data = work.path.join("data");
        let result = repair(
            source.to_str().unwrap(),
            output.to_str().unwrap(),
            RepairOptions {
                target_sdk: 24,
                add_exported: true,
                allow_cleartext: false,
            },
            &data,
        )
        .unwrap();
        assert!(output.is_file());
        assert!(result.signature_verified);
        assert!(result.alignment_verified);
        assert!(Path::new(&result.report_json_path).is_file());
        assert!(Path::new(&result.report_markdown_path).is_file());
        assert!(!Path::new(&format!("{}.idsig", output.display())).exists());
        let report = crate::scanner::scan(output.to_str().unwrap(), None).unwrap();
        assert_eq!(report.target_before, Some(24));
    }

    #[test]
    #[ignore = "requires APK_COMPAT_LEGACY_FIXTURE"]
    fn repairs_legacy_fixture() {
        let source = env::var("APK_COMPAT_LEGACY_FIXTURE").unwrap();
        let work = WorkDir::new().unwrap();
        let output = work.path.join("repaired.apk");
        let result = repair(
            &source,
            output.to_str().unwrap(),
            RepairOptions {
                target_sdk: 36,
                add_exported: true,
                allow_cleartext: false,
            },
            &work.path.join("data"),
        )
        .unwrap();
        assert!(result
            .changes
            .contains(&"使用 Apktool 2 + AAPT1 旧版兼容链路".to_owned()));
        assert!(result.signature_verified);
        assert!(result.alignment_verified);
    }
}
