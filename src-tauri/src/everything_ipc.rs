use crate::{models::EverythingSettings, storage, AppError};
use serde::Serialize;
use std::{path::{Path, PathBuf}, process::Command, sync::{mpsc, Mutex, OnceLock}, time::{Duration, Instant}};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EverythingDetection { pub installed: bool, pub running: bool, pub executable_path: Option<String>, pub message: String }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EverythingSearchItem { pub key: String, pub name: String, pub path: String, pub is_directory: bool }

#[derive(Default)]
pub struct EverythingState(pub Mutex<()>);

type IpcReplySender = mpsc::Sender<Option<Vec<u8>>>;

fn executable_from_service() -> Option<PathBuf> {
    let output = Command::new("sc.exe").args(["qc", "Everything"]).output().ok()?;
    if !output.status.success() { return None; }
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().find(|line| line.contains("BINARY_PATH_NAME"))?.split_once(':')?.1.trim();
    let value = if let Some(rest) = line.strip_prefix('"') { rest.split('"').next().unwrap_or(rest) } else { line.split(" -").next().unwrap_or(line).trim() };
    let path = PathBuf::from(value);
    path.is_file().then_some(path)
}

#[cfg(windows)]
fn executable_from_registry() -> Option<PathBuf> {
    const KEYS: [&str; 3] = [
        r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Everything",
        r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Everything",
        r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Everything",
    ];
    for key in KEYS {
        for value_name in ["DisplayIcon", "InstallLocation"] {
            let output = Command::new("reg.exe").args(["query", key, "/v", value_name]).output().ok()?;
            if !output.status.success() { continue; }
            let text = String::from_utf8_lossy(&output.stdout);
            let Some(line) = text.lines().find(|line| line.contains(value_name) && line.contains("REG_")) else { continue; };
            let Some((_, value)) = line.split_once("REG_SZ").or_else(|| line.split_once("REG_EXPAND_SZ")) else { continue; };
            let raw = value.trim().trim_matches('"').trim_end_matches(",0").trim_matches('"');
            let candidate = if value_name == "InstallLocation" { PathBuf::from(raw).join("Everything.exe") } else { PathBuf::from(raw) };
            if candidate.is_file() { return Some(candidate); }
        }
    }
    None
}

#[cfg(not(windows))]
fn executable_from_registry() -> Option<PathBuf> { None }

fn configured(app: &AppHandle) -> Result<EverythingSettings, AppError> { Ok(storage::load(&storage::data_path(app)?)?.settings.everything) }

#[cfg(windows)]
fn running() -> bool {
    use windows::{core::w, Win32::UI::WindowsAndMessaging::FindWindowW};
    unsafe { FindWindowW(w!("EVERYTHING_TASKBAR_NOTIFICATION"), None).is_ok() }
}
#[cfg(not(windows))] fn running() -> bool { false }

fn detect(app: &AppHandle) -> Result<EverythingDetection, AppError> {
    let settings = configured(app)?;
    let path = settings.executable_path.map(PathBuf::from).filter(|path| path.is_file())
        .or_else(executable_from_service).or_else(executable_from_registry);
    let active = running();
    let message = if active { "Everything IPC 已连接" } else if path.is_some() { "已找到 Everything，当前未运行" } else { "未检测到 Everything.exe" };
    Ok(EverythingDetection { installed: path.is_some(), running: active, executable_path: path.map(|path| path.to_string_lossy().to_string()), message: message.into() })
}

#[tauri::command]
pub fn detect_everything(app: AppHandle) -> Result<EverythingDetection, AppError> { detect(&app) }

fn ensure_running(app: &AppHandle) -> Result<(), AppError> {
    if running() { return Ok(()); }
    let settings = configured(app)?;
    if !settings.enabled { return Err(AppError::Message("Everything 集成尚未启用".into())); }
    let path = settings.executable_path.map(PathBuf::from).filter(|path| path.is_file())
        .or_else(executable_from_service).or_else(executable_from_registry)
        .ok_or_else(|| AppError::Message("未找到已确认的 Everything.exe".into()))?;
    if !path.file_name().is_some_and(|name| name.eq_ignore_ascii_case("Everything.exe")) { return Err(AppError::Message("Everything 程序路径无效".into())); }
    Command::new(path).arg("-startup").spawn()?;
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(3) { if running() { return Ok(()); } std::thread::sleep(Duration::from_millis(60)); }
    Err(AppError::Message("Everything 启动后未建立 IPC 连接".into()))
}

#[cfg(windows)]
fn query_ipc(query: &str, limit: u32) -> Result<Vec<EverythingSearchItem>, AppError> {
    use windows::{
        core::{w, PCWSTR},
        Win32::{Foundation::{HWND, LPARAM, LRESULT, WPARAM}, System::{DataExchange::COPYDATASTRUCT, LibraryLoader::GetModuleHandleW},
        UI::WindowsAndMessaging::{ChangeWindowMessageFilterEx, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, FindWindowW, GetMessageW, KillTimer, RegisterClassW, SendMessageW, SetTimer, TranslateMessage, MSG, MSGFLT_ALLOW, WM_COPYDATA, WM_TIMER, WNDCLASSW, WINDOW_EX_STYLE, WINDOW_STYLE}},
    };
    const REPLY_ID: usize = 0;
    static REPLY: OnceLock<Mutex<Option<IpcReplySender>>> = OnceLock::new();
    unsafe extern "system" fn wndproc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if message == WM_COPYDATA {
            let cds = unsafe { &*(lparam.0 as *const COPYDATASTRUCT) };
            if cds.dwData == REPLY_ID && !cds.lpData.is_null() {
                let bytes = unsafe { std::slice::from_raw_parts(cds.lpData as *const u8, cds.cbData as usize) }.to_vec();
                if let Ok(mut sender) = REPLY.get_or_init(Default::default).lock() { if let Some(sender) = sender.take() { let _ = sender.send(Some(bytes)); } }
                return LRESULT(1);
            }
        }
        if message == WM_TIMER {
            if let Ok(mut sender) = REPLY.get_or_init(Default::default).lock() { if let Some(sender) = sender.take() { let _ = sender.send(None); } }
            return LRESULT(0);
        }
        unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
    }
    let everything = unsafe { FindWindowW(w!("EVERYTHING_TASKBAR_NOTIFICATION"), None) }.map_err(|_| AppError::Message("Everything IPC 窗口不可用".into()))?;
    let class_name: Vec<u16> = "DeskBoxEverythingReply\0".encode_utf16().collect();
    let instance = unsafe { GetModuleHandleW(None) }.map_err(|error| AppError::Message(error.to_string()))?;
    let class = WNDCLASSW { lpfnWndProc: Some(wndproc), hInstance: instance.into(), lpszClassName: PCWSTR(class_name.as_ptr()), ..Default::default() };
    unsafe { RegisterClassW(&class); }
    let window = unsafe { CreateWindowExW(WINDOW_EX_STYLE::default(), PCWSTR(class_name.as_ptr()), w!("DeskBox Everything"), WINDOW_STYLE::default(), 0, 0, 0, 0, None, None, Some(instance.into()), None) }
        .map_err(|error| AppError::Message(error.to_string()))?;
    unsafe { ChangeWindowMessageFilterEx(window, WM_COPYDATA, MSGFLT_ALLOW, None) }.map_err(|error| AppError::Message(error.to_string()))?;
    let (sender, receiver) = mpsc::channel();
    *REPLY.get_or_init(Default::default).lock().map_err(|_| AppError::Message("Everything IPC 状态不可用".into()))? = Some(sender);
    let search: Vec<u16> = query.encode_utf16().chain(Some(0)).collect();
    let mut request = Vec::with_capacity(28 + search.len() * 2);
    for value in [window.0 as usize as u32, 0, 0, 0, limit.clamp(1, 100), 0x4, 1] { request.extend_from_slice(&value.to_le_bytes()); }
    for value in search { request.extend_from_slice(&value.to_le_bytes()); }
    let cds = COPYDATASTRUCT { dwData: 18, cbData: request.len() as u32, lpData: request.as_ptr() as *mut _ };
    let accepted = unsafe { SendMessageW(everything, WM_COPYDATA, Some(WPARAM(window.0 as usize)), Some(LPARAM(&cds as *const _ as isize))) };
    if accepted.0 == 0 { unsafe { let _ = DestroyWindow(window); } return Err(AppError::Message("当前 Everything 版本不支持 Query2 IPC".into())); }
    unsafe { SetTimer(Some(window), 1, 2000, None); }
    let reply = loop {
        let mut message = MSG::default();
        let result = unsafe { GetMessageW(&mut message, None, 0, 0) };
        if result.0 <= 0 { unsafe { let _ = KillTimer(Some(window), 1); let _ = DestroyWindow(window); } return Err(AppError::Message("Everything 消息循环失败".into())); }
        unsafe { let _ = TranslateMessage(&message); DispatchMessageW(&message); }
        if let Ok(reply) = receiver.try_recv() { break reply; }
    };
    unsafe { let _ = KillTimer(Some(window), 1); }
    let Some(bytes) = reply else { unsafe { let _ = DestroyWindow(window); } return Err(AppError::Message("Everything 查询超时".into())); };
    unsafe { let _ = DestroyWindow(window); }
    parse_list(&bytes)
}

#[cfg(windows)]
fn parse_list(bytes: &[u8]) -> Result<Vec<EverythingSearchItem>, AppError> {
    fn u32_at(bytes: &[u8], offset: usize) -> Option<u32> { Some(u32::from_le_bytes(bytes.get(offset..offset + 4)?.try_into().ok()?)) }
    let count = u32_at(bytes, 4).ok_or_else(|| AppError::Message("Everything 返回数据无效".into()))? as usize;
    if bytes.len() < 20 + count * 8 { return Err(AppError::Message("Everything 返回数据不完整".into())); }
    let mut output = Vec::new();
    for index in 0..count {
        let flags = u32_at(bytes, 20 + index * 8).unwrap_or(0);
        let offset = u32_at(bytes, 24 + index * 8).unwrap_or(0) as usize;
        let length = u32_at(bytes, offset).unwrap_or(0) as usize;
        let end = offset.saturating_add(4).saturating_add(length.saturating_mul(2));
        if end > bytes.len() { continue; }
        let units: Vec<u16> = bytes[offset + 4..end].chunks_exact(2).map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]])).collect();
        let path = String::from_utf16_lossy(&units);
        if path.is_empty() { continue; }
        let name = Path::new(&path).file_name().map(|value| value.to_string_lossy().to_string()).unwrap_or_else(|| path.clone());
        output.push(EverythingSearchItem { key: format!("file:{}", path.to_lowercase()), name, path, is_directory: flags & 1 != 0 });
    }
    Ok(output)
}

#[cfg(not(windows))] fn query_ipc(_: &str, _: u32) -> Result<Vec<EverythingSearchItem>, AppError> { Ok(Vec::new()) }

#[tauri::command]
pub fn search_everything(app: AppHandle, state: tauri::State<EverythingState>, query: String, limit: Option<u32>) -> Result<Vec<EverythingSearchItem>, AppError> {
    let query = query.trim();
    if query.chars().count() < 2 { return Ok(Vec::new()); }
    let _guard = state.0.lock().map_err(|_| AppError::Message("Everything 查询忙".into()))?;
    ensure_running(&app)?;
    query_ipc(query, limit.unwrap_or(30))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_invalid_list_safely() { #[cfg(windows)] assert!(parse_list(&[0; 4]).is_err()); }
    #[test]
    #[ignore = "requires a running and fully indexed Everything instance"]
    fn queries_running_everything_when_available() {
        #[cfg(windows)] if running() {
            let items = query_ipc("Windows", 5).expect("running Everything should answer Query2 IPC");
            assert!(!items.is_empty());
            assert!(items.len() <= 5);
        }
    }
}
