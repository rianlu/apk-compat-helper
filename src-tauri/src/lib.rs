mod device;
mod repair;
mod scanner;

use std::path::PathBuf;
use tauri::{Emitter, Manager};

pub(crate) fn background_command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new(program);
    #[cfg(not(target_os = "windows"))]
    let command = std::process::Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

#[cfg(target_os = "windows")]
fn command_compatible_path(path: PathBuf) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(value) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{value}"));
    }
    if let Some(value) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(value);
    }
    drop(value);
    path
}

#[cfg(not(target_os = "windows"))]
fn command_compatible_path(path: PathBuf) -> PathBuf {
    path
}

#[tauri::command]
async fn scan_apk(path: String, target_sdk: Option<u32>) -> Result<scanner::ScanReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        scanner::scan(&path, target_sdk).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn repair_apk(
    app: tauri::AppHandle,
    path: String,
    output_path: String,
    options: repair::RepairOptions,
) -> Result<repair::RepairResult, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let progress_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        repair::repair_with_progress(&path, &output_path, options, &data_dir, |stage| {
            let _ = progress_app.emit("repair-progress", stage);
        })
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_devices() -> Result<Vec<device::Device>, String> {
    tauri::async_runtime::spawn_blocking(|| device::list().map_err(|error| error.to_string()))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn install_apk(serial: String, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        device::install(&serial, &path).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    let path = std::path::Path::new(&path);
    if !path.exists() {
        return Err("输出文件不存在".into());
    }
    #[cfg(target_os = "macos")]
    let status = background_command("open").arg("-R").arg(path).status();
    #[cfg(target_os = "windows")]
    let status = background_command("explorer")
        .arg(format!("/select,{}", path.display()))
        .status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let status = background_command("xdg-open")
        .arg(path.parent().unwrap_or(path))
        .status();
    status
        .map_err(|error| error.to_string())?
        .success()
        .then_some(())
        .ok_or_else(|| "无法打开输出目录".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let platform = if cfg!(target_os = "macos") {
                "macos"
            } else {
                "windows"
            };
            let resource_dir = command_compatible_path(app.path().resource_dir()?);
            let tools = resource_dir.join("resources/tooling").join(platform);
            let common_tools = resource_dir.join("resources/tooling/common");
            if tools.is_dir() {
                std::env::set_var("APK_COMPAT_TOOLS_DIR", tools);
            }
            if common_tools.is_dir() {
                std::env::set_var("APK_COMPAT_COMMON_TOOLS_DIR", common_tools);
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            scan_apk,
            repair_apk,
            list_devices,
            install_apk,
            reveal_path
        ])
        .run(tauri::generate_context!())
        .expect("failed to run APK Compat Helper");
}
