use crate::{
    app_state::{DataState, RuntimeStatus},
    container_windows, icons,
    models::{AppData, AppOperation},
    operations, storage,
    watcher::WatcherState,
    AppError,
};
use std::{path::Path, process::Command, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter, Manager, State};

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

fn emit_data_changed(app: &AppHandle, revision: u64) -> Result<(), AppError> {
    app.emit("app-data-changed", revision).map_err(|error| AppError::Message(error.to_string()))
}

#[tauri::command]
pub fn load_app_data(app: AppHandle) -> Result<AppData, AppError> {
    storage::load(&storage::data_path(&app)?)
}

#[tauri::command]
pub fn apply_app_operation(
    app: AppHandle,
    state: State<DataState>,
    operation: AppOperation,
) -> Result<AppData, AppError> {
    let _guard = state.0.lock().map_err(|_| AppError::Message("数据写入锁不可用".to_string()))?;
    let path = storage::data_path(&app)?;
    let mut data = storage::load(&path)?;
    operations::apply(&mut data, operation)?;
    storage::ensure_daily_backup(&path)?;
    storage::save(&path, &data)?;
    emit_data_changed(&app, data.revision)?;
    Ok(data)
}

#[tauri::command]
pub async fn create_container_window(app: AppHandle, container_id: String) -> Result<(), AppError> {
    container_windows::create_or_show(app, container_id).await
}

#[tauri::command]
pub fn hide_container_window(app: AppHandle, container_id: String) -> Result<(), AppError> {
    container_windows::hide(&app, &container_id)
}

#[tauri::command]
pub fn show_quick_launch(app: AppHandle) -> Result<(), AppError> {
    let window = app.get_webview_window("quick-launch")
        .ok_or_else(|| AppError::Message("快速启动窗口不可用".to_string()))?;
    window.center().map_err(|error| AppError::Message(error.to_string()))?;
    window.show().map_err(|error| AppError::Message(error.to_string()))?;
    window.set_focus().map_err(|error| AppError::Message(error.to_string()))?;
    window.emit("quick-launch-reset", ()).map_err(|error| AppError::Message(error.to_string()))
}

#[tauri::command]
pub fn pick_shortcut_path() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("程序与快捷方式", &["exe", "lnk"])
        .add_filter("所有文件", &["*"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn extract_icon(app: AppHandle, path: String) -> Result<Option<String>, AppError> {
    icons::extract(&app, &path)
}

fn is_web_url(target: &str) -> bool {
    url::Url::parse(target).map(|url| matches!(url.scheme(), "http" | "https")).unwrap_or(false)
}

fn launch_target(target: &str) -> Result<(), AppError> {
    if !is_web_url(target) {
        let path = Path::new(target);
        if !path.is_absolute() || !path.exists() {
            return Err(AppError::Message("只支持存在的绝对路径或 HTTP(S) 地址".to_string()));
        }
    }

    #[cfg(windows)]
    Command::new("powershell.exe")
        .env("DESKBOX_LAUNCH_TARGET", target)
        .args(["-NoProfile", "-NonInteractive", "-Command", "Start-Process -FilePath $env:DESKBOX_LAUNCH_TARGET"])
        .spawn()?;
    #[cfg(not(windows))]
    Command::new("xdg-open").arg(target).spawn()?;
    Ok(())
}

#[tauri::command]
pub fn launch_path(path: String) -> Result<(), AppError> {
    launch_target(path.trim())
}

#[tauri::command]
pub fn launch_shortcut(
    app: AppHandle,
    state: State<DataState>,
    shortcut_id: String,
) -> Result<AppData, AppError> {
    let _guard = state.0.lock().map_err(|_| AppError::Message("数据写入锁不可用".to_string()))?;
    let path = storage::data_path(&app)?;
    let mut data = storage::load(&path)?;
    let shortcut = data.containers.iter_mut().flat_map(|container| &mut container.shortcuts)
        .find(|item| item.id == shortcut_id)
        .ok_or_else(|| AppError::Message("快捷方式不存在".to_string()))?;
    launch_target(&shortcut.path)?;
    shortcut.launch_count = shortcut.launch_count.saturating_add(1);
    shortcut.last_launched_at = Some(now_ms());
    data.revision = data.revision.saturating_add(1);
    storage::ensure_daily_backup(&path)?;
    storage::save(&path, &data)?;
    emit_data_changed(&app, data.revision)?;
    Ok(data)
}

#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), AppError> {
    let target = Path::new(&path);
    if !target.is_absolute() || !target.exists() {
        return Err(AppError::Message("目标路径不存在".to_string()));
    }
    #[cfg(windows)]
    Command::new("explorer.exe").arg(format!("/select,{}", path)).spawn()?;
    #[cfg(not(windows))]
    if let Some(parent) = target.parent() {
        Command::new("xdg-open").arg(parent).spawn()?;
    }
    Ok(())
}

#[tauri::command]
pub fn configure_desktop_watcher(
    app: AppHandle,
    state: State<WatcherState>,
    enabled: bool,
) -> Result<(), AppError> {
    crate::watcher::configure(app, &state, enabled).map_err(AppError::Message)
}

#[tauri::command]
pub fn recycle_source(path: String) -> Result<(), AppError> {
    let source = Path::new(&path);
    if !source.exists() {
        return Ok(());
    }
    trash::delete(source).map_err(|error| AppError::Message(format!("移入回收站失败：{error}")))
}

#[tauri::command]
pub fn export_backup(app: AppHandle) -> Result<Option<String>, AppError> {
    let Some(target) = rfd::FileDialog::new()
        .set_file_name(format!("deskbox-backup-{}.json", chrono::Local::now().format("%Y%m%d")))
        .add_filter("DeskBox JSON 备份", &["json"])
        .save_file() else { return Ok(None) };
    let data = storage::load(&storage::data_path(&app)?)?;
    storage::save(&target, &data)?;
    Ok(Some(target.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn import_backup(app: AppHandle, state: State<DataState>) -> Result<Option<AppData>, AppError> {
    let Some(source) = rfd::FileDialog::new().add_filter("DeskBox JSON 备份", &["json"]).pick_file()
        else { return Ok(None) };
    let raw = std::fs::read_to_string(source)?;
    let (mut imported, _) = storage::parse_and_migrate(&raw)?;
    let _guard = state.0.lock().map_err(|_| AppError::Message("数据写入锁不可用".to_string()))?;
    let path = storage::data_path(&app)?;
    let current = storage::load(&path)?;
    storage::backup_before_import(&path)?;
    imported.revision = current.revision.max(imported.revision).saturating_add(1);
    storage::save(&path, &imported)?;
    container_windows::close_missing(&app, &imported);
    emit_data_changed(&app, imported.revision)?;
    Ok(Some(imported))
}

#[tauri::command]
pub fn open_backup_directory(app: AppHandle) -> Result<(), AppError> {
    let directory = storage::backup_dir(&app)?;
    #[cfg(windows)]
    Command::new("explorer.exe").arg(directory).spawn()?;
    #[cfg(not(windows))]
    Command::new("xdg-open").arg(directory).spawn()?;
    Ok(())
}

#[tauri::command]
pub fn get_runtime_status(status: State<RuntimeStatus>) -> Result<Option<String>, AppError> {
    status.0.lock().map(|value| value.clone()).map_err(|_| AppError::Message("运行状态不可用".to_string()))
}
