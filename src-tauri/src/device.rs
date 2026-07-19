use serde::Serialize;
use std::{
    env,
    error::Error,
    path::{Path, PathBuf},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    serial: String,
    status: String,
    model: String,
}

pub fn list() -> Result<Vec<Device>, Box<dyn Error>> {
    let output = crate::background_command(find_adb().ok_or("未找到 adb")?)
        .args(["devices", "-l"])
        .output()?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr)
            .trim()
            .to_owned()
            .into());
    }
    Ok(parse_devices(&String::from_utf8_lossy(&output.stdout)))
}

pub fn install(serial: &str, apk: &str) -> Result<String, Box<dyn Error>> {
    if serial.is_empty() || !Path::new(apk).is_file() {
        return Err("设备或 APK 路径无效".into());
    }
    let output = crate::background_command(find_adb().ok_or("未找到 adb")?)
        .args(["-s", serial, "install", "-r", apk])
        .output()?;
    if !output.status.success() {
        return Err(format!(
            "安装失败: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
        .into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn find_adb() -> Option<PathBuf> {
    let executable = if cfg!(target_os = "windows") {
        "adb.exe"
    } else {
        "adb"
    };
    env::var_os("APK_COMPAT_TOOLS_DIR")
        .map(PathBuf::from)
        .map(|path| path.join(executable))
        .filter(|path| path.is_file())
        .or_else(|| {
            env::var_os("ANDROID_HOME")
                .or_else(|| env::var_os("ANDROID_SDK_ROOT"))
                .map(PathBuf::from)
                .or_else(|| {
                    env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Android/sdk"))
                })
                .map(|path| path.join("platform-tools").join(executable))
                .filter(|path| path.is_file())
        })
}

fn parse_devices(output: &str) -> Vec<Device> {
    output
        .lines()
        .skip(1)
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let serial = parts.next()?.to_owned();
            let status = parts.next()?.to_owned();
            let model = parts
                .find_map(|part| part.strip_prefix("model:"))
                .unwrap_or("未知设备")
                .replace('_', " ");
            Some(Device {
                serial,
                status,
                model,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_adb_devices() {
        let devices = parse_devices("List of devices attached\nABC device product:x model:Pixel_8 device:y\nDEF unauthorized\n");
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].model, "Pixel 8");
        assert_eq!(devices[1].status, "unauthorized");
    }
}
