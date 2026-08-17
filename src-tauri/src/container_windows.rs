use crate::{models::AppData, storage, AppError};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::PathBuf};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const PREFIX: &str = "container-";
const DEFAULT_WIDTH: u32 = 420;
const DEFAULT_HEIGHT: u32 = 360;
const COLLAPSED_HEIGHT: u32 = 42;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerWindowSettings {
    pub monitor_key: Option<String>, pub x: i32, pub y: i32, pub width: u32, pub height: u32,
    #[serde(default)] pub expanded_height: u32, #[serde(default)] pub collapsed: bool,
    #[serde(default)] pub locked: bool, #[serde(default = "default_opacity")] pub opacity: u8,
    #[serde(default)] pub click_through: bool, #[serde(default)] pub snap_edge: String,
    #[serde(default)] pub auto_hide: bool, #[serde(default = "default_layout")] pub layout: String,
    #[serde(default)] pub skip_taskbar: bool, #[serde(default)] pub all_workspaces: bool,
}
fn default_opacity() -> u8 { 100 }
fn default_layout() -> String { "grid".into() }
impl Default for ContainerWindowSettings {
    fn default() -> Self { Self { monitor_key: None, x: 140, y: 120, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, expanded_height: DEFAULT_HEIGHT, collapsed: false, locked: false, opacity: 100, click_through: false, snap_edge: "none".into(), auto_hide: false, layout: "grid".into(), skip_taskbar: false, all_workspaces: false } }
}
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowState { #[serde(default)] windows: BTreeMap<String, ContainerWindowSettings> }
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo { pub key: String, pub name: Option<String>, pub x: i32, pub y: i32, pub width: u32, pub height: u32 }

fn path(app: &AppHandle) -> Result<PathBuf, AppError> { Ok(storage::data_path(app)?.with_file_name("deskbox-container-windows.json")) }
fn load(app: &AppHandle) -> Result<WindowState, AppError> { let file = path(app)?; if !file.exists() { return Ok(WindowState::default()); } match serde_json::from_str(&fs::read_to_string(file)?) { Ok(v) => Ok(v), Err(e) => { eprintln!("DeskBox 窗口布局无效，已忽略：{e}"); Ok(WindowState::default()) } } }
fn save(app: &AppHandle, state: &WindowState) -> Result<(), AppError> { let file = path(app)?; let tmp = file.with_extension("tmp"); fs::write(&tmp, serde_json::to_vec_pretty(state)?)?; if file.exists() { fs::remove_file(&file)?; } fs::rename(tmp, file)?; Ok(()) }
fn key(m: &tauri::Monitor) -> String { m.name().cloned().unwrap_or_else(|| { let p=m.position(); let s=m.size(); format!("monitor-{}-{}-{}x{}",p.x,p.y,s.width,s.height) }) }
fn default_position(app: &AppHandle) -> (i32,i32) { let Ok(Some(m))=app.primary_monitor() else { return (140,120); }; let a=m.work_area(); ((a.position.x+(a.size.width.saturating_sub(DEFAULT_WIDTH) as i32/2)-160).max(a.position.x),(a.position.y+(a.size.height.saturating_sub(DEFAULT_HEIGHT) as i32/2)-80).max(a.position.y)) }
fn sanitize(s: &mut ContainerWindowSettings) { s.opacity=s.opacity.clamp(60,100); s.width=s.width.clamp(280,2400); s.height=s.height.clamp(220,1600); if s.expanded_height==0 { s.expanded_height=s.height; } s.expanded_height=s.expanded_height.clamp(220,1600); if !matches!(s.layout.as_str(),"compact"|"grid"|"list") { s.layout="grid".into(); }; if !matches!(s.snap_edge.as_str(),"none"|"left"|"right"|"top"|"bottom") { s.snap_edge="none".into(); } }
pub fn label_for(id: &str) -> String { format!("{PREFIX}{id}") }
pub fn settings(app: &AppHandle, id: &str) -> Result<ContainerWindowSettings, AppError> { let mut s=load(app)?.windows.get(id).cloned().unwrap_or_else(|| { let (x,y)=default_position(app); ContainerWindowSettings { x,y,..Default::default() } }); if let Some(w)=app.get_webview_window(&label_for(id)) { if let Ok(p)=w.outer_position(){s.x=p.x;s.y=p.y;}; if let Ok(z)=w.inner_size(){s.width=z.width;if !s.collapsed{s.height=z.height;s.expanded_height=z.height;}} s.monitor_key=w.current_monitor().ok().flatten().map(|m|key(&m)); } sanitize(&mut s); Ok(s) }

#[cfg(windows)]
fn set_opacity(window: &WebviewWindow, opacity: u8) -> Result<(), AppError> { use windows::Win32::UI::WindowsAndMessaging::{GetWindowLongW,SetLayeredWindowAttributes,SetWindowLongW,GWL_EXSTYLE,LWA_ALPHA,WS_EX_LAYERED}; let hwnd=window.hwnd().map_err(|e|AppError::Message(e.to_string()))?; let alpha=((u16::from(opacity)*255)/100) as u8; unsafe { let style=GetWindowLongW(hwnd,GWL_EXSTYLE); if style & WS_EX_LAYERED.0 as i32 == 0 { SetWindowLongW(hwnd,GWL_EXSTYLE,style|WS_EX_LAYERED.0 as i32); } SetLayeredWindowAttributes(hwnd,windows::Win32::Foundation::COLORREF(0),alpha,LWA_ALPHA).map_err(|e|AppError::Message(e.to_string()))?; } Ok(()) }
#[cfg(not(windows))] fn set_opacity(_: &WebviewWindow, _: u8) -> Result<(), AppError> { Ok(()) }
pub fn apply_runtime(window: &WebviewWindow, s: &ContainerWindowSettings) -> Result<(), AppError> { window.set_resizable(!s.locked).map_err(|e|AppError::Message(e.to_string()))?; window.set_skip_taskbar(s.skip_taskbar).map_err(|e|AppError::Message(e.to_string()))?; window.set_visible_on_all_workspaces(s.all_workspaces).ok(); window.set_ignore_cursor_events(s.click_through).map_err(|e|AppError::Message(e.to_string()))?; set_opacity(window,s.opacity) }
pub fn set_pinned(app: &AppHandle, id: &str, pinned: bool) -> Result<(), AppError> { if let Some(w)=app.get_webview_window(&label_for(id)){ w.set_always_on_top(pinned).map_err(|e|AppError::Message(e.to_string()))?; } Ok(()) }

fn save_geometry(app: &AppHandle, id: &str, window: &WebviewWindow) { let result=(||->Result<(),AppError>{ let mut p=window.outer_position().map_err(|e|AppError::Message(e.to_string()))?; let z=window.inner_size().map_err(|e|AppError::Message(e.to_string()))?; let mut state=load(app)?; let mut s=state.windows.remove(id).unwrap_or_default(); if let Some(m)=window.current_monitor().ok().flatten() { let area=m.work_area(); let threshold=18; if s.snap_edge=="left" && (p.x-area.position.x).abs()<=threshold { p.x=area.position.x; } else if s.snap_edge=="right" && (p.x+z.width as i32-(area.position.x+area.size.width as i32)).abs()<=threshold { p.x=area.position.x+area.size.width as i32-z.width as i32; } else if s.snap_edge=="top" && (p.y-area.position.y).abs()<=threshold { p.y=area.position.y; } else if s.snap_edge=="bottom" && (p.y+z.height as i32-(area.position.y+area.size.height as i32)).abs()<=threshold { p.y=area.position.y+area.size.height as i32-z.height as i32; } s.monitor_key=Some(key(&m)); if p.x!=window.outer_position().map_err(|e|AppError::Message(e.to_string()))?.x || p.y!=window.outer_position().map_err(|e|AppError::Message(e.to_string()))?.y { window.set_position(tauri::Position::Physical(p)).ok(); } } s.x=p.x; s.y=p.y; s.width=z.width; if !s.collapsed { s.height=z.height; s.expanded_height=z.height; } sanitize(&mut s); state.windows.insert(id.into(),s); save(app,&state)})(); if let Err(e)=result { eprintln!("DeskBox 保存窗口布局失败：{e}"); } }

pub async fn create_or_show(app: AppHandle, id: String) -> Result<(), AppError> { let data=storage::load(&storage::data_path(&app)?)?; let container=data.containers.iter().find(|c|c.id==id).ok_or_else(||AppError::Message("容器不存在或已删除".into()))?; let label=label_for(&id); let mut s=settings(&app,&id)?; if let Some(window)=app.get_webview_window(&label) { window.unminimize().ok(); window.show().map_err(|e|AppError::Message(e.to_string()))?; apply_runtime(&window,&s)?; window.set_always_on_top(container.pinned).ok(); window.set_focus().ok(); return Ok(()); } sanitize(&mut s); let builder=WebviewWindowBuilder::new(&app,&label,WebviewUrl::App("index.html".into())).title(format!("DeskBox - {}",container.name)).decorations(false).transparent(true).always_on_top(container.pinned).resizable(!s.locked).min_inner_size(280.0,220.0).inner_size(s.width as f64,if s.collapsed { COLLAPSED_HEIGHT } else { s.height } as f64).position(s.x as f64,s.y as f64).visible(true); #[cfg(windows)] let builder=builder.drag_and_drop(true); let window=builder.build().map_err(|e|AppError::Message(e.to_string()))?; apply_runtime(&window,&s)?; let a=app.clone(); let i=id.clone(); let w=window.clone(); window.on_window_event(move |e| match e { WindowEvent::CloseRequested{api,..}=>{api.prevent_close();let _=w.hide();}, WindowEvent::Moved(_)|WindowEvent::Resized(_)=>save_geometry(&a,&i,&w), _=>{} }); window.show().ok(); window.set_focus().ok(); Ok(()) }
pub fn update_settings(app:&AppHandle,id:&str,mut s:ContainerWindowSettings)->Result<ContainerWindowSettings,AppError>{ sanitize(&mut s); if let Some(w)=app.get_webview_window(&label_for(id)){ let h=if s.collapsed { COLLAPSED_HEIGHT } else { if s.expanded_height==0{s.height}else{s.expanded_height} }; if !s.collapsed{s.height=h;} w.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(s.width,h))).map_err(|e|AppError::Message(e.to_string()))?; w.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(s.x,s.y))).map_err(|e|AppError::Message(e.to_string()))?; apply_runtime(&w,&s)?; } let mut state=load(app)?; state.windows.insert(id.into(),s.clone()); save(app,&state)?; Ok(s) }
pub fn hide(app:&AppHandle,id:&str)->Result<(),AppError>{if let Some(w)=app.get_webview_window(&label_for(id)){w.hide().map_err(|e|AppError::Message(e.to_string()))?;}Ok(())}
pub fn show_all(app:&AppHandle)->Result<(),AppError>{for(label,w)in app.webview_windows(){if label.starts_with(PREFIX){w.unminimize().ok();w.show().ok();}}Ok(())}
pub fn hide_all(app:&AppHandle)->Result<(),AppError>{for(label,w)in app.webview_windows(){if label.starts_with(PREFIX){w.hide().ok();}}Ok(())}
pub async fn toggle_all(app: AppHandle) -> Result<(), AppError> {
    let any_visible = app.webview_windows().into_iter().any(|(label, window)| label.starts_with(PREFIX) && window.is_visible().unwrap_or(false));
    if any_visible { return hide_all(&app); }
    let data = storage::load(&storage::data_path(&app)?)?;
    for container in data.containers.into_iter().filter(|item| !item.hidden) { create_or_show(app.clone(), container.id).await?; }
    Ok(())
}
pub fn restore_mouse_interaction(app:&AppHandle)->Result<(),AppError>{let mut state=load(app)?;for s in state.windows.values_mut(){s.click_through=false;}for(label,w)in app.webview_windows(){if label.starts_with(PREFIX){w.set_ignore_cursor_events(false).ok();}}save(app,&state)}
pub fn monitors(app:&AppHandle)->Result<Vec<MonitorInfo>,AppError>{let w=app.get_webview_window("main").ok_or_else(||AppError::Message("主窗口不可用".into()))?;Ok(w.available_monitors().map_err(|e|AppError::Message(e.to_string()))?.iter().map(|m|{let p=m.position();let z=m.size();MonitorInfo{key:key(m),name:m.name().cloned(),x:p.x,y:p.y,width:z.width,height:z.height}}).collect())}
pub fn close_missing(app:&AppHandle,data:&AppData){for(label,w)in app.webview_windows(){let Some(id)=label.strip_prefix(PREFIX)else{continue;};if !data.containers.iter().any(|c|c.id==id){let _=w.destroy();}}}
