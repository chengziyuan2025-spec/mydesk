use crate::{
    app_state::{DataState, RuntimeStatus},
    container_windows, icons, launcher, wallpaper,
    models::{AppData, AppOperation, ShortcutInfo},
    operations, storage,
    watcher::WatcherState,
    AppError,
};
use std::{
    fs,
    path::Path,
    process::Command,
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn emit_data_changed(app: &AppHandle, revision: u64) -> Result<(), AppError> {
    app.emit("app-data-changed", revision)
        .map_err(|error| AppError::Message(error.to_string()))
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
    let _guard = state
        .0
        .lock()
        .map_err(|_| AppError::Message("数据写入锁不可用".to_string()))?;
    let path = storage::data_path(&app)?;
    let mut data = storage::load(&path)?;
    let removed_hotkey = if let AppOperation::DeleteContainer { container_id, .. } = &operation {
        data.containers.iter().find(|item| item.id == *container_id).and_then(|item| item.hotkey.clone())
    } else { None };
    operations::apply(&mut data, operation)?;
    storage::ensure_daily_backup(&path)?;
    storage::save(&path, &data)?;
    if let Some(accelerator) = removed_hotkey { crate::hotkeys::unregister(&app, &accelerator); }
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
pub fn get_container_window_settings(app: AppHandle, container_id: String) -> Result<container_windows::ContainerWindowSettings, AppError> {
    container_windows::settings(&app, &container_id)
}

#[tauri::command]
pub fn update_container_window_settings(app: AppHandle, container_id: String, settings: container_windows::ContainerWindowSettings) -> Result<container_windows::ContainerWindowSettings, AppError> {
    container_windows::update_settings(&app, &container_id, settings)
}

#[tauri::command]
pub fn show_all_container_windows(app: AppHandle) -> Result<(), AppError> { container_windows::show_all(&app) }

#[tauri::command]
pub fn hide_all_container_windows(app: AppHandle) -> Result<(), AppError> { container_windows::hide_all(&app) }

#[tauri::command]
pub fn list_monitors(app: AppHandle) -> Result<Vec<container_windows::MonitorInfo>, AppError> { container_windows::monitors(&app) }

#[tauri::command]
pub fn set_container_window_pinned(app: AppHandle, container_id: String, pinned: bool) -> Result<(), AppError> { container_windows::set_pinned(&app, &container_id, pinned) }

#[tauri::command]
pub fn restore_container_mouse_interaction(app: AppHandle) -> Result<(), AppError> { container_windows::restore_mouse_interaction(&app) }

#[tauri::command]
pub fn reveal_container_window_dock(app: AppHandle, container_id: String) -> Result<container_windows::ContainerWindowSettings, AppError> {
    container_windows::reveal_dock(&app, &container_id)
}

#[tauri::command]
pub fn dock_container_window(app: AppHandle, container_id: String) -> Result<container_windows::ContainerWindowSettings, AppError> {
    container_windows::dock(&app, &container_id)
}

#[tauri::command]
pub fn get_wallpaper_dominant_color() -> Option<String> {
    wallpaper::dominant_color()
}

#[tauri::command]
pub fn show_quick_launch(app: AppHandle) -> Result<(), AppError> {
    let window = app
        .get_webview_window("quick-launch")
        .ok_or_else(|| AppError::Message("快速启动窗口不可用".to_string()))?;
    window
        .center()
        .map_err(|error| AppError::Message(error.to_string()))?;
    window
        .show()
        .map_err(|error| AppError::Message(error.to_string()))?;
    window
        .set_focus()
        .map_err(|error| AppError::Message(error.to_string()))?;
    window
        .emit("quick-launch-reset", ())
        .map_err(|error| AppError::Message(error.to_string()))
}

#[tauri::command]
pub fn pick_shortcut_path() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("程序与快捷方式", &["exe", "lnk"])
        .add_filter("所有文件", &["*"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundMediaSelection {
    pub kind: String,
    pub asset_path: String,
    pub asset_name: String,
}

fn background_kind(path: &Path) -> Option<&'static str> {
    match path.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase().as_str() {
        "png" | "jpg" | "jpeg" | "webp" | "gif" => Some("image"),
        "mp4" | "webm" => Some("video"),
        _ => None,
    }
}

#[tauri::command]
pub fn pick_background_media(app: AppHandle) -> Result<Option<BackgroundMediaSelection>, AppError> {
    let Some(source) = rfd::FileDialog::new()
        .add_filter("图片", &["png", "jpg", "jpeg", "webp", "gif"])
        .add_filter("视频", &["mp4", "webm"])
        .pick_file()
    else { return Ok(None); };
    let kind = background_kind(&source).ok_or_else(|| AppError::Message("不支持的背景媒体格式".into()))?;
    let extension = source.extension().and_then(|value| value.to_str()).unwrap_or("bin").to_ascii_lowercase();
    let assets = storage::background_assets_dir(&app)?;
    let mut suffix = 0_u32;
    let target = loop {
        let candidate = assets.join(format!("background-{}-{suffix}.{extension}", now_ms()));
        if !candidate.exists() { break candidate; }
        suffix = suffix.saturating_add(1);
    };
    copy_background_media(&source, &target)?;
    Ok(Some(BackgroundMediaSelection {
        kind: kind.to_string(),
        asset_path: target.to_string_lossy().to_string(),
        asset_name: source.file_name().and_then(|value| value.to_str()).unwrap_or("背景媒体").to_string(),
    }))
}

fn copy_background_media(source: &Path, target: &Path) -> Result<(), AppError> {
    let mut last_error = None;
    for attempt in 0..3 {
        match fs::copy(source, target) {
            Ok(_) => return Ok(()),
            Err(error) => {
                last_error = Some(error);
                if attempt < 2 { thread::sleep(std::time::Duration::from_millis(160)); }
            }
        }
    }
    let error = last_error.expect("copy loop always records an error");
    Err(AppError::Message(format!(
        "无法复制背景媒体「{}」到 DeskBox 数据目录：{error}",
        source.display()
    )))
}

#[tauri::command]
pub fn delete_background_asset(app: AppHandle, asset_path: String) -> Result<(), AppError> {
    let assets = storage::background_assets_dir(&app)?;
    let candidate = Path::new(asset_path.trim());
    if !candidate.exists() { return Ok(()); }
    let candidate = managed_background_asset_path(&assets, candidate)?;
    fs::remove_file(candidate)?;
    Ok(())
}

fn managed_background_asset_path(assets: &Path, candidate: &Path) -> Result<std::path::PathBuf, AppError> {
    if !candidate.is_absolute() { return Err(AppError::Message("背景媒体路径无效".into())); }
    let assets = assets.canonicalize()?;
    let candidate = candidate.canonicalize()?;
    if !candidate.starts_with(&assets) { return Err(AppError::Message("只能删除 DeskBox 导入的背景媒体".into())); }
    Ok(candidate)
}

#[tauri::command]
pub fn extract_icon(app: AppHandle, path: String) -> Result<Option<String>, AppError> {
    icons::extract(&app, &path)
}

fn is_web_url(target: &str) -> bool {
    url::Url::parse(target)
        .map(|url| matches!(url.scheme(), "http" | "https"))
        .unwrap_or(false)
}

fn validate_launch_target(target: &str) -> Result<(), AppError> {
    if target.is_empty() {
        return Err(AppError::Message("启动目标不能为空".to_string()));
    }
    if !is_web_url(target) {
        let path = Path::new(target);
        if !path.is_absolute() || !path.exists() {
            return Err(AppError::Message(
                "只支持存在的绝对路径或 HTTP(S) 地址".to_string(),
            ));
        }
    }
    Ok(())
}

pub(crate) fn launch_target(
    target: &str,
    arguments: Option<&str>,
    working_directory: Option<&str>,
) -> Result<(), AppError> {
    let target = target.trim();
    validate_launch_target(target)?;

    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::{
            core::PCWSTR,
            Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
        };

        fn wide(value: &str) -> Vec<u16> {
            std::ffi::OsStr::new(value)
                .encode_wide()
                .chain(Some(0))
                .collect()
        }

        let target = wide(target);
        let arguments = arguments.filter(|value| !value.trim().is_empty()).map(wide);
        let working_directory = working_directory
            .filter(|value| !value.trim().is_empty())
            .map(wide);
        let arguments = arguments
            .as_ref()
            .map_or(PCWSTR::null(), |value| PCWSTR(value.as_ptr()));
        let working_directory = working_directory
            .as_ref()
            .map_or(PCWSTR::null(), |value| PCWSTR(value.as_ptr()));
        let result = unsafe {
            ShellExecuteW(
                None,
                PCWSTR::null(),
                PCWSTR(target.as_ptr()),
                arguments,
                working_directory,
                SW_SHOWNORMAL,
            )
        };
        let code = result.0 as isize;
        if code <= 32 {
            return Err(AppError::Message(format!(
                "启动失败，ShellExecuteW 错误码：{code}"
            )));
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (arguments, working_directory);
        Command::new("xdg-open").arg(target).spawn()?;
    }
    Ok(())
}

#[cfg(windows)]
pub(crate) fn launch_shell_app(app_id: &str) -> Result<(), AppError> {
    if app_id.trim().is_empty() || app_id.contains("..") || !app_id.chars().all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '!' | '+' | '-' | '{' | '}' | '\\')) { return Err(AppError::Message("系统应用标识无效".into())); }
    let target = format!("shell:AppsFolder\\{}", app_id.trim());
    use std::os::windows::ffi::OsStrExt;
    use windows::{core::PCWSTR, Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL}};
    let wide: Vec<u16> = std::ffi::OsStr::new(&target).encode_wide().chain(Some(0)).collect();
    let result = unsafe { ShellExecuteW(None, PCWSTR::null(), PCWSTR(wide.as_ptr()), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
    if result.0 as isize <= 32 { return Err(AppError::Message("系统应用启动失败".into())); }
    Ok(())
}

#[cfg(not(windows))]
pub(crate) fn launch_shell_app(_: &str) -> Result<(), AppError> { Err(AppError::Message("当前平台不支持系统应用".into())) }

#[tauri::command]
pub fn launch_path(path: String) -> Result<(), AppError> {
    launch_target(path.trim(), None, None)
}

#[tauri::command]
pub fn launch_shortcut(
    app: AppHandle,
    state: State<DataState>,
    catalog_state: State<launcher::SystemCatalogState>,
    shortcut_id: String,
) -> Result<AppData, AppError> {
    let _guard = state
        .0
        .lock()
        .map_err(|_| AppError::Message("数据写入锁不可用".to_string()))?;
    let path = storage::data_path(&app)?;
    let mut data = storage::load(&path)?;
    let shortcut = data
        .containers
        .iter_mut()
        .flat_map(|container| &mut container.shortcuts)
        .find(|item| item.id == shortcut_id)
        .ok_or_else(|| AppError::Message("快捷方式不存在".to_string()))?;
    match shortcut.target_type {
        crate::models::LaunchTargetType::ShellApp => {
            if !launcher::is_catalog_shell_app(&app, &catalog_state, &shortcut.path) {
                return Err(AppError::Message("系统应用标识不在当前应用目录中".into()));
            }
            launch_shell_app(&shortcut.path)?
        }
        _ => launch_target(&shortcut.path, shortcut.arguments.as_deref(), shortcut.working_directory.as_deref())?,
    }
    shortcut.launch_count = shortcut.launch_count.saturating_add(1);
    shortcut.last_launched_at = Some(now_ms());
    data.revision = data.revision.saturating_add(1);
    storage::ensure_daily_backup(&path)?;
    storage::save(&path, &data)?;
    emit_data_changed(&app, data.revision)?;
    Ok(data)
}

#[tauri::command]
pub fn is_directory(path: String) -> bool {
    Path::new(&path).is_dir()
}

#[tauri::command]
pub fn get_file_name(path: String) -> Result<String, AppError> {
    Path::new(&path)
        .file_name()
        .filter(|name| !name.is_empty())
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| AppError::Message("无法从路径获取文件名".to_string()))
}

#[cfg(windows)]
fn resolve_shortcut_impl(path: &Path) -> Result<ShortcutInfo, AppError> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::{Interface, GUID, PCWSTR},
        Win32::{
            Foundation::RPC_E_CHANGED_MODE,
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile,
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ,
            },
            UI::Shell::IShellLinkW,
        },
    };

    struct ComGuard(bool);
    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    fn text(buffer: &[u16]) -> Option<String> {
        let end = buffer
            .iter()
            .position(|character| *character == 0)
            .unwrap_or(buffer.len());
        let value = String::from_utf16_lossy(&buffer[..end]);
        (!value.trim().is_empty()).then_some(value)
    }

    if !path.is_absolute() || !path.exists() {
        return Err(AppError::Message(
            "快捷方式必须是存在的绝对路径".to_string(),
        ));
    }
    if !path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("lnk"))
    {
        return Err(AppError::Message("只能解析 .lnk 快捷方式".to_string()));
    }

    let init = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    if init.is_err() && init != RPC_E_CHANGED_MODE {
        return Err(AppError::Message(format!("初始化 COM 失败：{init:?}")));
    }
    let _com = ComGuard(init.is_ok());

    const CLSID_SHELL_LINK: GUID = GUID::from_u128(0x00021401_0000_0000_c000_000000000046);
    let shell_link: IShellLinkW = unsafe {
        CoCreateInstance(&CLSID_SHELL_LINK, None, CLSCTX_INPROC_SERVER)
            .map_err(|error| AppError::Message(format!("创建 ShellLink 失败：{error}")))?
    };
    let persist: IPersistFile = shell_link
        .cast()
        .map_err(|error| AppError::Message(format!("获取 IPersistFile 失败：{error}")))?;
    let path_wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe { persist.Load(PCWSTR(path_wide.as_ptr()), STGM_READ) }
        .map_err(|error| AppError::Message(format!("读取快捷方式失败：{error}")))?;

    let mut target = vec![0u16; 32_768];
    let mut arguments = vec![0u16; 32_768];
    let mut working_directory = vec![0u16; 32_768];
    unsafe { shell_link.GetPath(&mut target, std::ptr::null_mut(), 0) }
        .map_err(|error| AppError::Message(format!("读取快捷方式目标失败：{error}")))?;
    unsafe { shell_link.GetArguments(&mut arguments) }
        .map_err(|error| AppError::Message(format!("读取快捷方式参数失败：{error}")))?;
    unsafe { shell_link.GetWorkingDirectory(&mut working_directory) }
        .map_err(|error| AppError::Message(format!("读取快捷方式工作目录失败：{error}")))?;

    let target_path =
        text(&target).ok_or_else(|| AppError::Message("快捷方式没有有效的目标路径".to_string()))?;
    let name = path
        .file_stem()
        .filter(|name| !name.is_empty())
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| AppError::Message("快捷方式名称无效".to_string()))?;
    Ok(ShortcutInfo {
        name,
        target_path,
        arguments: text(&arguments),
        working_directory: text(&working_directory),
    })
}

#[tauri::command]
pub fn resolve_shortcut(path: String) -> Result<ShortcutInfo, AppError> {
    #[cfg(windows)]
    {
        resolve_shortcut_impl(Path::new(&path))
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err(AppError::Message(
            "当前平台不支持解析 Windows 快捷方式".to_string(),
        ))
    }
}

#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), AppError> {
    let target = Path::new(&path);
    if !target.is_absolute() || !target.exists() {
        return Err(AppError::Message("目标路径不存在".to_string()));
    }
    #[cfg(windows)]
    Command::new("explorer.exe")
        .arg(format!("/select,{}", path))
        .spawn()?;
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
pub fn hide_path(path: String) -> Result<(), AppError> {
    set_local_path_hidden(Path::new(path.trim()), true)
}

#[tauri::command]
pub fn show_path(path: String) -> Result<(), AppError> {
    set_local_path_hidden(Path::new(path.trim()), false)
}

#[tauri::command]
pub fn toggle_path_hidden(path: String) -> Result<bool, AppError> {
    let path = Path::new(path.trim());
    let hidden = is_local_path_hidden(path)?;
    set_local_path_hidden(path, !hidden)?;
    Ok(!hidden)
}

#[tauri::command]
pub fn get_path_hidden(path: String) -> Result<bool, AppError> {
    is_local_path_hidden(Path::new(path.trim()))
}

fn is_local_path_hidden(path: &Path) -> Result<bool, AppError> {
    if !path.is_absolute() || !path.exists() {
        return Err(AppError::Message("只能处理存在的绝对路径".into()));
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::Win32::Storage::FileSystem::{GetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM};
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let attributes = unsafe { GetFileAttributesW(windows::core::PCWSTR(wide.as_ptr())) };
        if attributes == u32::MAX { return Err(AppError::Message("无法读取文件属性".into())); }
        Ok(attributes & (FILE_ATTRIBUTE_HIDDEN.0 | FILE_ATTRIBUTE_SYSTEM.0) != 0)
    }
    #[cfg(not(windows))]
    { Ok(false) }
}

fn set_local_path_hidden(path: &Path, hidden: bool) -> Result<(), AppError> {
    if !path.is_absolute() || !path.exists() { return Err(AppError::Message("只能处理存在的绝对路径".into())); }
    #[cfg(windows)] {
        use std::os::windows::ffi::OsStrExt;
        use windows::Win32::Storage::FileSystem::{GetFileAttributesW, SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM};
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            let attributes = GetFileAttributesW(windows::core::PCWSTR(wide.as_ptr()));
            if attributes == u32::MAX { return Err(AppError::Message("无法读取文件属性".into())); }
            let managed = FILE_ATTRIBUTE_HIDDEN.0 | FILE_ATTRIBUTE_SYSTEM.0;
            let next = if hidden { attributes | managed } else { attributes & !managed };
            SetFileAttributesW(windows::core::PCWSTR(wide.as_ptr()), windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES(next)).map_err(|error| AppError::Message(error.to_string()))?;
            use std::ffi::c_void;
            use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ATTRIBUTES, SHCNF_PATHW};
            SHChangeNotify(SHCNE_ATTRIBUTES, SHCNF_PATHW, Some(wide.as_ptr() as *const c_void), None);
            let verified = GetFileAttributesW(windows::core::PCWSTR(wide.as_ptr()));
            if verified == u32::MAX {
                return Err(AppError::Message("属性设置后无法验证文件状态".into()));
            }
            let is_hidden = verified & managed != 0;
            if is_hidden != hidden {
                return Err(AppError::Message("文件属性未能按预期更新，请检查文件权限".into()));
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn hide_paths(paths: Vec<String>) -> Result<usize, AppError> {
    let mut hidden = 0;
    for path in paths {
        if path.starts_with("http://") || path.starts_with("https://") { continue; }
        if set_local_path_hidden(Path::new(path.trim()), true).is_ok() {
            hidden += 1;
        }
    }
    Ok(hidden)
}

#[tauri::command]
pub fn show_paths(paths: Vec<String>) -> Result<usize, AppError> {
    let mut shown = 0;
    for path in paths {
        if path.starts_with("http://") || path.starts_with("https://") { continue; }
        if set_local_path_hidden(Path::new(path.trim()), false).is_ok() {
            shown += 1;
        }
    }
    Ok(shown)
}

#[tauri::command]
pub fn export_backup(app: AppHandle) -> Result<Option<String>, AppError> {
    let Some(target) = rfd::FileDialog::new()
        .set_file_name(format!(
            "deskbox-backup-{}.json",
            chrono::Local::now().format("%Y%m%d")
        ))
        .add_filter("DeskBox JSON 备份", &["json"])
        .save_file()
    else {
        return Ok(None);
    };
    let data = storage::load(&storage::data_path(&app)?)?;
    storage::save(&target, &data)?;
    Ok(Some(target.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn import_backup(app: AppHandle, state: State<DataState>) -> Result<Option<AppData>, AppError> {
    let Some(source) = rfd::FileDialog::new()
        .add_filter("DeskBox JSON 备份", &["json"])
        .pick_file()
    else {
        return Ok(None);
    };
    let raw = std::fs::read_to_string(source)?;
    let (mut imported, _) = storage::parse_and_migrate(&raw)?;
    let _guard = state
        .0
        .lock()
        .map_err(|_| AppError::Message("数据写入锁不可用".to_string()))?;
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
    status
        .0
        .lock()
        .map(|value| value.clone())
        .map_err(|_| AppError::Message("运行状态不可用".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_background_media_extensions() {
        assert_eq!(background_kind(Path::new("C:\\image.webp")), Some("image"));
        assert_eq!(background_kind(Path::new("C:\\video.webm")), Some("video"));
        assert_eq!(background_kind(Path::new("C:\\unsafe.exe")), None);
    }

    #[test]
    fn only_accepts_assets_inside_the_managed_directory() {
        let root = std::env::temp_dir().join(format!("deskbox-background-test-{}", now_ms()));
        let assets = root.join("assets");
        fs::create_dir_all(&assets).unwrap();
        let managed = assets.join("background.png");
        let outside = root.join("outside.png");
        fs::write(&managed, []).unwrap();
        fs::write(&outside, []).unwrap();
        assert!(managed_background_asset_path(&assets, &managed).is_ok());
        assert!(managed_background_asset_path(&assets, &outside).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn copies_background_media_into_the_managed_directory() {
        let root = std::env::temp_dir().join(format!("deskbox-background-copy-test-{}", now_ms()));
        let source = root.join("source.png");
        let assets = root.join("assets");
        let target = assets.join("background.png");
        fs::create_dir_all(&assets).unwrap();
        fs::write(&source, [1_u8, 2, 3, 4]).unwrap();
        copy_background_media(&source, &target).unwrap();
        assert_eq!(fs::read(&target).unwrap(), vec![1, 2, 3, 4]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn gets_complete_file_name_from_path() {
        let path = std::env::temp_dir().join("DeskBox Example.exe");
        assert_eq!(
            get_file_name(path.to_string_lossy().into_owned()).unwrap(),
            "DeskBox Example.exe"
        );
    }

    #[test]
    fn detects_existing_directory() {
        assert!(is_directory(
            std::env::temp_dir().to_string_lossy().into_owned()
        ));
    }

    #[test]
    fn validates_supported_launch_targets() {
        assert!(validate_launch_target("https://example.com/app").is_ok());
        assert!(validate_launch_target("relative.exe").is_err());
        assert!(validate_launch_target("powershell.exe -Command whoami").is_err());
        assert!(validate_launch_target("file:///C:/Windows/System32/cmd.exe").is_err());
        assert!(validate_launch_target("custom-protocol:payload").is_err());
        assert!(validate_launch_target("").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn hides_and_restores_managed_file_attributes() {
        use std::os::windows::ffi::OsStrExt;
        use windows::Win32::Storage::FileSystem::{
            GetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM,
        };

        let path = std::env::temp_dir().join(format!("deskbox-hide-{}.txt", now_ms()));
        std::fs::write(&path, b"DeskBox hidden attribute test").unwrap();
        set_local_path_hidden(&path, true).unwrap();

        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let hidden_attributes = unsafe { GetFileAttributesW(windows::core::PCWSTR(wide.as_ptr())) };
        let hidden = hidden_attributes & FILE_ATTRIBUTE_HIDDEN.0 != 0;
        let system = hidden_attributes & FILE_ATTRIBUTE_SYSTEM.0 != 0;

        set_local_path_hidden(&path, false).unwrap();
        let restored_attributes = unsafe { GetFileAttributesW(windows::core::PCWSTR(wide.as_ptr())) };
        let restored_hidden = restored_attributes & FILE_ATTRIBUTE_HIDDEN.0 != 0;
        let restored_system = restored_attributes & FILE_ATTRIBUTE_SYSTEM.0 != 0;
        std::fs::remove_file(path).unwrap();

        assert!(hidden && system);
        assert!(!restored_hidden && !restored_system);
    }

    #[cfg(windows)]
    #[test]
    fn shortcut_resolver_rejects_non_lnk_files() {
        let path = std::env::temp_dir().join(format!("deskbox-resolve-{}.txt", now_ms()));
        std::fs::write(&path, b"not a shortcut").unwrap();
        let result = resolve_shortcut(path.to_string_lossy().into_owned());
        std::fs::remove_file(path).unwrap();
        assert!(result.is_err());
    }

    #[cfg(windows)]
    #[test]
    fn shortcut_resolver_reads_target_arguments_and_working_directory() {
        use std::os::windows::ffi::OsStrExt;
        use windows::{
            core::{Interface, GUID, PCWSTR},
            Win32::{
                System::Com::{
                    CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile,
                    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
                },
                UI::Shell::IShellLinkW,
            },
        };

        struct ComGuard;
        impl Drop for ComGuard {
            fn drop(&mut self) {
                unsafe { CoUninitialize() };
            }
        }

        fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
            value.encode_wide().chain(Some(0)).collect()
        }

        let init = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        assert!(init.is_ok(), "test COM initialization failed: {init:?}");
        let _com = ComGuard;

        let suffix = now_ms();
        let directory = std::env::temp_dir();
        let target = directory.join(format!("deskbox-target-{suffix}.txt"));
        let shortcut = directory.join(format!("DeskBox Resolve {suffix}.lnk"));
        std::fs::write(&target, b"DeskBox shortcut target").unwrap();

        const CLSID_SHELL_LINK: GUID = GUID::from_u128(0x00021401_0000_0000_c000_000000000046);
        let target_wide = wide(target.as_os_str());
        let directory_wide = wide(directory.as_os_str());
        let arguments_wide = wide(std::ffi::OsStr::new("--deskbox-test \"two words\""));
        let shortcut_wide = wide(shortcut.as_os_str());

        {
            let shell_link: IShellLinkW =
                unsafe { CoCreateInstance(&CLSID_SHELL_LINK, None, CLSCTX_INPROC_SERVER).unwrap() };
            unsafe {
                shell_link.SetPath(PCWSTR(target_wide.as_ptr())).unwrap();
                shell_link
                    .SetArguments(PCWSTR(arguments_wide.as_ptr()))
                    .unwrap();
                shell_link
                    .SetWorkingDirectory(PCWSTR(directory_wide.as_ptr()))
                    .unwrap();
            }
            let persist: IPersistFile = shell_link.cast().unwrap();
            unsafe { persist.Save(PCWSTR(shortcut_wide.as_ptr()), true) }.unwrap();
        }

        let info = resolve_shortcut(shortcut.to_string_lossy().into_owned()).unwrap();
        assert_eq!(info.name, format!("DeskBox Resolve {suffix}"));
        assert_eq!(Path::new(&info.target_path), target.as_path());
        assert_eq!(
            info.arguments.as_deref(),
            Some("--deskbox-test \"two words\"")
        );
        assert_eq!(info.working_directory.as_deref(), directory.to_str());

        std::fs::remove_file(shortcut).unwrap();
        std::fs::remove_file(target).unwrap();
    }
}
