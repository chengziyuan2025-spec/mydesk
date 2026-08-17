use crate::{app_state::DataState, models::AppData, storage, AppError};
use serde::{Deserialize, Serialize};
use std::{collections::{BTreeMap, HashSet}, fs, path::PathBuf, sync::Mutex, time::{Duration, Instant}};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

const PREFIX: &str = "container-";
const DEFAULT_WIDTH: u32 = 420;
const DEFAULT_HEIGHT: u32 = 360;
const COLLAPSED_HEIGHT: u32 = 42;
const DOCK_REVEAL_WIDTH: i32 = 10;

#[derive(Default)]
struct PendingLayout {
    values: BTreeMap<String, ContainerWindowSettings>,
    generations: BTreeMap<String, u64>,
    active: HashSet<String>,
}

#[derive(Default)]
pub struct WindowLayoutState {
    layout: Mutex<Option<WindowState>>,
    saves: Mutex<PendingLayout>,
    geometry_generations: Mutex<BTreeMap<String, u64>>,
    geometry_active: Mutex<HashSet<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerWindowSettings {
    pub monitor_key: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub expanded_height: u32,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub locked: bool,
    #[serde(default = "default_opacity")]
    pub opacity: u8,
    #[serde(default)]
    pub click_through: bool,
    #[serde(default)]
    pub snap_edge: String,
    #[serde(default)]
    pub auto_hide: bool,
    #[serde(default)]
    pub docked: bool,
    #[serde(default)]
    pub dock_side: Option<String>,
    #[serde(default = "default_layout")]
    pub layout: String,
    #[serde(default)]
    pub skip_taskbar: bool,
    #[serde(default)]
    pub all_workspaces: bool,
}

fn default_opacity() -> u8 {
    100
}

fn default_layout() -> String {
    "grid".into()
}

impl Default for ContainerWindowSettings {
    fn default() -> Self {
        Self {
            monitor_key: None,
            x: 140,
            y: 120,
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            expanded_height: DEFAULT_HEIGHT,
            collapsed: false,
            locked: false,
            opacity: 100,
            click_through: false,
            snap_edge: "none".into(),
            auto_hide: false,
            docked: false,
            dock_side: None,
            layout: "grid".into(),
            skip_taskbar: false,
            all_workspaces: false,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowState {
    #[serde(default)]
    windows: BTreeMap<String, ContainerWindowSettings>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub key: String,
    pub name: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

fn path(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(storage::data_path(app)?.with_file_name("deskbox-container-windows.json"))
}

fn load(app: &AppHandle) -> Result<WindowState, AppError> {
    let file = path(app)?;
    if !file.exists() {
        return Ok(WindowState::default());
    }
    match serde_json::from_str(&fs::read_to_string(file)?) {
        Ok(value) => Ok(value),
        Err(error) => {
            eprintln!("DeskBox 窗口布局无效，已忽略：{error}");
            Ok(WindowState::default())
        }
    }
}

fn save(app: &AppHandle, state: &WindowState) -> Result<(), AppError> {
    let file = path(app)?;
    storage::atomic_write(&file, &serde_json::to_vec_pretty(state)?)
}

fn layout_snapshot(app: &AppHandle) -> Result<WindowState, AppError> {
    let state = app.state::<WindowLayoutState>();
    let mut cached = state
        .layout
        .lock()
        .map_err(|_| AppError::Message("窗口布局状态不可用".into()))?;
    if cached.is_none() {
        *cached = Some(load(app)?);
    }
    Ok(cached.as_ref().expect("window layout initialized").clone())
}

fn update_layout_memory(
    app: &AppHandle,
    id: &str,
    settings: ContainerWindowSettings,
) -> Result<(), AppError> {
    let state = app.state::<WindowLayoutState>();
    let mut cached = state
        .layout
        .lock()
        .map_err(|_| AppError::Message("窗口布局状态不可用".into()))?;
    if cached.is_none() {
        *cached = Some(load(app)?);
    }
    cached
        .as_mut()
        .expect("window layout initialized")
        .windows
        .insert(id.to_string(), settings);
    Ok(())
}

fn replace_layout_memory(app: &AppHandle, layout: WindowState) -> Result<(), AppError> {
    *app
        .state::<WindowLayoutState>()
        .layout
        .lock()
        .map_err(|_| AppError::Message("窗口布局状态不可用".into()))? = Some(layout);
    Ok(())
}

fn persist_layout_memory(app: &AppHandle) -> Result<(), AppError> {
    let layout = layout_snapshot(app)?;
    save(app, &layout)
}

pub fn flush(app: &AppHandle) -> Result<(), AppError> {
    for (label, window) in app.webview_windows() {
        let Some(id) = label.strip_prefix(PREFIX) else { continue; };
        save_geometry(app, id, &window);
    }
    persist_layout_memory(app)
}

fn key(monitor: &tauri::Monitor) -> String {
    monitor.name().cloned().unwrap_or_else(|| {
        let position = monitor.position();
        let size = monitor.size();
        format!(
            "monitor-{}-{}-{}x{}",
            position.x, position.y, size.width, size.height
        )
    })
}

fn default_position(app: &AppHandle) -> (i32, i32) {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return (140, 120);
    };
    let area = monitor.work_area();
    (
        (area.position.x + (area.size.width.saturating_sub(DEFAULT_WIDTH) as i32 / 2) - 160)
            .max(area.position.x),
        (area.position.y + (area.size.height.saturating_sub(DEFAULT_HEIGHT) as i32 / 2) - 80)
            .max(area.position.y),
    )
}

fn monitor_for_settings(
    app: &AppHandle,
    settings: &ContainerWindowSettings,
) -> Option<tauri::Monitor> {
    let monitors = app
        .get_webview_window("main")
        .and_then(|window| window.available_monitors().ok())
        .unwrap_or_default();
    if let Some(monitor_key) = settings.monitor_key.as_deref() {
        if let Some(monitor) = monitors.iter().find(|monitor| key(monitor) == monitor_key) {
            return Some(monitor.clone());
        }
    }
    if let Some(monitor) = monitors.iter().find(|monitor| {
        let area = monitor.work_area();
        settings.x >= area.position.x
            && settings.x < area.position.x + area.size.width as i32
            && settings.y >= area.position.y
            && settings.y < area.position.y + area.size.height as i32
    }) {
        return Some(monitor.clone());
    }
    app.primary_monitor().ok().flatten()
}

fn constrain_to_work_area(
    settings: &mut ContainerWindowSettings,
    area_position: PhysicalPosition<i32>,
    area_size: PhysicalSize<u32>,
) {
    let min_width = 280.min(area_size.width);
    let min_height = 220.min(area_size.height);
    settings.width = settings.width.clamp(min_width, area_size.width);
    settings.height = settings.height.clamp(min_height, area_size.height);
    settings.expanded_height = settings.expanded_height.clamp(min_height, area_size.height);

    let visible_height = if settings.collapsed { COLLAPSED_HEIGHT } else { settings.height };
    let max_y = area_position.y + area_size.height.saturating_sub(visible_height) as i32;
    settings.y = settings.y.clamp(area_position.y, max_y);
    if !settings.docked {
        let max_x = area_position.x + area_size.width.saturating_sub(settings.width) as i32;
        settings.x = settings.x.clamp(area_position.x, max_x);
    }
}

fn constrain_saved_geometry(app: &AppHandle, settings: &mut ContainerWindowSettings) {
    if let Some(monitor) = monitor_for_settings(app, settings) {
        let area = monitor.work_area();
        constrain_to_work_area(settings, area.position, area.size);
        settings.monitor_key = Some(key(&monitor));
    }
}

fn valid_dock_side(value: &str) -> bool {
    matches!(value, "left" | "right")
}

fn sanitize(settings: &mut ContainerWindowSettings) {
    settings.opacity = settings.opacity.clamp(60, 100);
    settings.width = settings.width.clamp(280, 2400);
    settings.height = settings.height.clamp(220, 1600);
    if settings.expanded_height == 0 {
        settings.expanded_height = settings.height;
    }
    settings.expanded_height = settings.expanded_height.clamp(220, 1600);
    if !matches!(settings.layout.as_str(), "compact" | "grid" | "list") {
        settings.layout = "grid".into();
    }
    if !matches!(
        settings.snap_edge.as_str(),
        "none" | "left" | "right" | "top" | "bottom"
    ) {
        settings.snap_edge = "none".into();
    }
    if settings
        .dock_side
        .as_deref()
        .is_some_and(|side| !valid_dock_side(side))
    {
        settings.dock_side = None;
    }
    if !settings.auto_hide || settings.dock_side.is_none() {
        settings.docked = false;
        if !settings.auto_hide {
            settings.dock_side = None;
        }
    }
}

pub fn label_for(id: &str) -> String {
    format!("{PREFIX}{id}")
}

fn monitor_for_saved_settings(
    window: &WebviewWindow,
    settings: &ContainerWindowSettings,
) -> Option<tauri::Monitor> {
    if let Some(monitor_key) = &settings.monitor_key {
        if let Ok(monitors) = window.available_monitors() {
            if let Some(monitor) = monitors
                .into_iter()
                .find(|monitor| key(monitor) == *monitor_key)
            {
                return Some(monitor);
            }
        }
    }
    window.current_monitor().ok().flatten()
}

fn current_monitor(
    window: &WebviewWindow,
    settings: &ContainerWindowSettings,
) -> Option<tauri::Monitor> {
    window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| monitor_for_saved_settings(window, settings))
}

fn dock_side_for(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    monitor: &tauri::Monitor,
) -> Option<&'static str> {
    let work_area = monitor.work_area();
    let right = work_area.position.x + work_area.size.width as i32;
    if position.x <= work_area.position.x {
        Some("left")
    } else if position.x + size.width as i32 >= right {
        Some("right")
    } else {
        None
    }
}

fn hidden_x(side: &str, monitor: &tauri::Monitor, width: u32) -> i32 {
    let area = monitor.work_area();
    dock_x(side, area.position.x, area.size.width, width)
}

fn dock_x(side: &str, work_area_x: i32, work_area_width: u32, width: u32) -> i32 {
    match side {
        "left" => work_area_x - width as i32 + DOCK_REVEAL_WIDTH,
        "right" => work_area_x + work_area_width as i32 - DOCK_REVEAL_WIDTH,
        _ => work_area_x,
    }
}

fn expanded_x(side: &str, monitor: &tauri::Monitor, width: u32) -> i32 {
    let area = monitor.work_area();
    match side {
        "left" => area.position.x,
        "right" => area.position.x + area.size.width as i32 - width as i32,
        _ => area.position.x,
    }
}

fn apply_snap(
    settings: &ContainerWindowSettings,
    position: &mut PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    monitor: &tauri::Monitor,
) {
    let area = monitor.work_area();
    let threshold = 18;
    if settings.snap_edge == "left" && (position.x - area.position.x).abs() <= threshold {
        position.x = area.position.x;
    } else if settings.snap_edge == "right"
        && (position.x + size.width as i32 - (area.position.x + area.size.width as i32)).abs()
            <= threshold
    {
        position.x = area.position.x + area.size.width as i32 - size.width as i32;
    } else if settings.snap_edge == "top" && (position.y - area.position.y).abs() <= threshold {
        position.y = area.position.y;
    } else if settings.snap_edge == "bottom"
        && (position.y + size.height as i32 - (area.position.y + area.size.height as i32)).abs()
            <= threshold
    {
        position.y = area.position.y + area.size.height as i32 - size.height as i32;
    }
}

fn schedule_window_state_save(app: &AppHandle, id: &str, settings: ContainerWindowSettings) {
    if let Err(error) = update_layout_memory(app, id, settings.clone()) {
        eprintln!("DeskBox 更新窗口布局内存失败：{error}");
        return;
    }
    let state = app.state::<WindowLayoutState>();
    let should_spawn = match state.saves.lock() {
        Ok(mut pending) => {
            pending.values.insert(id.to_string(), settings);
            let generation = pending.generations.entry(id.to_string()).or_default();
            *generation = generation.saturating_add(1);
            pending.active.insert(id.to_string())
        }
        Err(_) => false,
    };
    if !should_spawn { return; }
    let app = app.clone();
    let id = id.to_string();
    std::thread::spawn(move || {
        let mut observed = app
            .state::<WindowLayoutState>()
            .saves
            .lock()
            .ok()
            .and_then(|pending| pending.generations.get(&id).copied())
            .unwrap_or_default();
        loop {
            std::thread::sleep(Duration::from_millis(300));
            let state = app.state::<WindowLayoutState>();
            let ready = match state.saves.lock() {
                Ok(mut pending) => {
                    let generation = pending.generations.get(&id).copied().unwrap_or_default();
                    if observed != generation { observed = generation; continue; }
                    pending.active.remove(&id);
                    pending.generations.remove(&id);
                    pending.values.remove(&id);
                    true
                }
                Err(_) => false,
            };
            if !ready { return; }
            let started = Instant::now();
            let result = persist_layout_memory(&app);
            if let Err(error) = result { eprintln!("DeskBox 延迟保存窗口布局失败：{error}"); }
            #[cfg(debug_assertions)]
            eprintln!("[deskbox:perf] window-layout persist serialize_write={}ms", started.elapsed().as_millis());
            return;
        }
    });
}

fn schedule_geometry_save(app: &AppHandle, id: &str, window: &WebviewWindow) {
    let state = app.state::<WindowLayoutState>();
    let should_spawn = match state.geometry_generations.lock() {
        Ok(mut generations) => {
            let generation = generations.entry(id.to_string()).or_default();
            *generation = generation.saturating_add(1);
            match state.geometry_active.lock() {
                Ok(mut active) => active.insert(id.to_string()),
                Err(_) => false,
            }
        }
        Err(_) => false,
    };
    if !should_spawn { return; }
    let app = app.clone();
    let id = id.to_string();
    let window = window.clone();
    std::thread::spawn(move || {
        let mut observed = app
            .state::<WindowLayoutState>()
            .geometry_generations
            .lock()
            .ok()
            .and_then(|generations| generations.get(&id).copied())
            .unwrap_or_default();
        loop {
            std::thread::sleep(Duration::from_millis(300));
            let state = app.state::<WindowLayoutState>();
            let generation = state.geometry_generations.lock().ok().and_then(|generations| generations.get(&id).copied()).unwrap_or_default();
            if observed != generation { observed = generation; continue; }
            if let Ok(mut active) = state.geometry_active.lock() { active.remove(&id); }
            if let Ok(mut generations) = state.geometry_generations.lock() { generations.remove(&id); }
            save_geometry(&app, &id, &window);
            return;
        }
    });
}

pub fn settings(app: &AppHandle, id: &str) -> Result<ContainerWindowSettings, AppError> {
    let mut settings = layout_snapshot(app)?.windows.get(id).cloned().unwrap_or_else(|| {
        let (x, y) = default_position(app);
        ContainerWindowSettings {
            x,
            y,
            ..Default::default()
        }
    });

    if let Some(window) = app.get_webview_window(&label_for(id)) {
        if !settings.docked {
            if let Ok(position) = window.outer_position() {
                settings.x = position.x;
                settings.y = position.y;
            }
        }
        if let Ok(size) = window.inner_size() {
            settings.width = size.width;
            if !settings.collapsed {
                settings.height = size.height;
                settings.expanded_height = size.height;
            }
        }
        let monitor = if settings.docked {
            monitor_for_saved_settings(&window, &settings)
        } else {
            current_monitor(&window, &settings)
        };
        settings.monitor_key = monitor.map(|monitor| key(&monitor));
    }
    sanitize(&mut settings);
    Ok(settings)
}

#[cfg(windows)]
fn set_opacity(window: &WebviewWindow, opacity: u8) -> Result<(), AppError> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, SetLayeredWindowAttributes, SetWindowLongW, GWL_EXSTYLE, LWA_ALPHA,
        WS_EX_LAYERED,
    };

    let hwnd = window
        .hwnd()
        .map_err(|error| AppError::Message(error.to_string()))?;
    let alpha = ((u16::from(opacity) * 255) / 100) as u8;
    unsafe {
        let style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        if style & WS_EX_LAYERED.0 as i32 == 0 {
            SetWindowLongW(hwnd, GWL_EXSTYLE, style | WS_EX_LAYERED.0 as i32);
        }
        SetLayeredWindowAttributes(
            hwnd,
            windows::Win32::Foundation::COLORREF(0),
            alpha,
            LWA_ALPHA,
        )
        .map_err(|error| AppError::Message(error.to_string()))?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn set_opacity(_: &WebviewWindow, _: u8) -> Result<(), AppError> {
    Ok(())
}

pub fn apply_runtime(
    window: &WebviewWindow,
    settings: &ContainerWindowSettings,
) -> Result<(), AppError> {
    window
        .set_resizable(!settings.locked)
        .map_err(|error| AppError::Message(error.to_string()))?;
    window
        .set_skip_taskbar(settings.skip_taskbar)
        .map_err(|error| AppError::Message(error.to_string()))?;
    window
        .set_visible_on_all_workspaces(settings.all_workspaces)
        .ok();
    window
        .set_ignore_cursor_events(settings.click_through)
        .map_err(|error| AppError::Message(error.to_string()))?;
    set_opacity(window, settings.opacity)
}

fn apply_dock_cursor_policy(window: &WebviewWindow, settings: &ContainerWindowSettings) {
    if settings.docked {
        // The edge hot zone remains interactive even for a normally click-through window.
        window.set_ignore_cursor_events(false).ok();
    }
}

pub fn set_pinned(app: &AppHandle, id: &str, pinned: bool) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window(&label_for(id)) {
        window
            .set_always_on_top(pinned)
            .map_err(|error| AppError::Message(error.to_string()))?;
    }
    Ok(())
}

fn save_geometry(app: &AppHandle, id: &str, window: &WebviewWindow) {
    let result = (|| -> Result<(), AppError> {
        let actual_position = window
            .outer_position()
            .map_err(|error| AppError::Message(error.to_string()))?;
        let size = window
            .inner_size()
            .map_err(|error| AppError::Message(error.to_string()))?;
        let mut settings = layout_snapshot(app)?.windows.get(id).cloned().unwrap_or_else(|| {
            let (x, y) = default_position(app);
            ContainerWindowSettings {
                x,
                y,
                ..Default::default()
            }
        });

        let mut saved_position = actual_position;
        if let Some(monitor) = current_monitor(window, &settings) {
            settings.monitor_key = Some(key(&monitor));
            let is_at_hidden_position = settings.docked
                && settings
                    .dock_side
                    .as_deref()
                    .is_some_and(|side| actual_position.x == hidden_x(side, &monitor, size.width));
            let is_at_revealed_dock_position = !settings.docked
                && settings.dock_side.as_deref().is_some_and(|side| {
                    actual_position.x == expanded_x(side, &monitor, size.width)
                });

            if is_at_hidden_position {
                saved_position.x = actual_position.x;
            } else if is_at_revealed_dock_position {
                // A programmatic reveal also emits Moved; wait for the frontend's leave timer
                // instead of immediately interpreting this as another user edge drag.
                saved_position.x = actual_position.x;
            } else if settings.auto_hide {
                if let Some(side) = dock_side_for(actual_position, size, &monitor) {
                    settings.docked = true;
                    settings.dock_side = Some(side.into());
                    saved_position.x = hidden_x(side, &monitor, size.width);
                } else {
                    settings.docked = false;
                    settings.dock_side = None;
                    apply_snap(&settings, &mut saved_position, size, &monitor);
                }
            } else {
                settings.docked = false;
                settings.dock_side = None;
                apply_snap(&settings, &mut saved_position, size, &monitor);
            }
        } else {
            settings.docked = false;
            settings.dock_side = None;
        }

        settings.x = saved_position.x;
        settings.y = saved_position.y;
        settings.width = size.width;
        if !settings.collapsed {
            settings.height = size.height;
            settings.expanded_height = size.height;
        }
        sanitize(&mut settings);
        update_layout_memory(app, id, settings.clone())?;
        persist_layout_memory(app)?;

        if settings.docked {
            apply_dock_cursor_policy(window, &settings);
        }
        if saved_position != actual_position {
            window.set_position(Position::Physical(saved_position)).ok();
        }
        Ok(())
    })();

    if let Err(error) = result {
        eprintln!("DeskBox 保存窗口布局失败：{error}");
    }
}

pub async fn create_or_show(app: AppHandle, id: String) -> Result<(), AppError> {
    let data = app.state::<DataState>().read(&app)?;
    let container = data
        .containers
        .iter()
        .find(|container| container.id == id)
        .ok_or_else(|| AppError::Message("容器不存在或已删除".into()))?;
    let label = label_for(&id);
    let mut settings = settings(&app, &id)?;
    if settings.docked {
        if let (Some(side), Some(monitor)) = (
            settings.dock_side.clone(),
            monitor_for_settings(&app, &settings),
        ) {
            settings.x = expanded_x(&side, &monitor, settings.width);
            settings.monitor_key = Some(key(&monitor));
        }
        settings.docked = false;
    }
    constrain_saved_geometry(&app, &mut settings);
    let height = if settings.collapsed {
        COLLAPSED_HEIGHT
    } else {
        settings.height
    };

    if let Some(window) = app.get_webview_window(&label) {
        window
            .set_size(Size::Physical(PhysicalSize::new(settings.width, height)))
            .map_err(|error| AppError::Message(error.to_string()))?;
        window
            .set_position(Position::Physical(PhysicalPosition::new(settings.x, settings.y)))
            .map_err(|error| AppError::Message(error.to_string()))?;
        schedule_window_state_save(&app, &id, settings.clone());
        window.unminimize().ok();
        window
            .show()
            .map_err(|error| AppError::Message(error.to_string()))?;
        apply_runtime(&window, &settings)?;
        apply_dock_cursor_policy(&window, &settings);
        window.set_always_on_top(container.pinned).ok();
        if !settings.docked {
            window.set_focus().ok();
        }
        return Ok(());
    }

    sanitize(&mut settings);
    update_layout_memory(&app, &id, settings.clone())?;
    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title(format!("DeskBox - {}", container.name))
        .decorations(false)
        .always_on_top(container.pinned)
        .resizable(!settings.locked)
        .visible(false);
    #[cfg(windows)]
    let builder = builder.drag_and_drop(true);
    let window = builder
        .build()
        .map_err(|error| AppError::Message(error.to_string()))?;
    window
        .set_min_size(Some(Size::Physical(PhysicalSize::new(280, 220))))
        .map_err(|error| AppError::Message(error.to_string()))?;
    window
        .set_size(Size::Physical(PhysicalSize::new(settings.width, height)))
        .map_err(|error| AppError::Message(error.to_string()))?;
    window
        .set_position(Position::Physical(PhysicalPosition::new(settings.x, settings.y)))
        .map_err(|error| AppError::Message(error.to_string()))?;
    apply_runtime(&window, &settings)?;
    apply_dock_cursor_policy(&window, &settings);

    let event_app = app.clone();
    let event_id = id.clone();
    let event_window = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            save_geometry(&event_app, &event_id, &event_window);
            let _ = event_window.hide();
        }
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            schedule_geometry_save(&event_app, &event_id, &event_window)
        }
        _ => {}
    });

    window
        .show()
        .map_err(|error| AppError::Message(error.to_string()))?;
    if !settings.docked {
        window.set_focus().ok();
    }
    Ok(())
}

pub fn reveal_dock(app: &AppHandle, id: &str) -> Result<ContainerWindowSettings, AppError> {
    let window = app
        .get_webview_window(&label_for(id))
        .ok_or_else(|| AppError::Message("容器窗口不可用".into()))?;
    let mut settings = layout_snapshot(app)?
        .windows
        .get(id)
        .cloned()
        .ok_or_else(|| AppError::Message("容器窗口布局不存在".into()))?;
    let Some(side) = settings.dock_side.clone() else {
        return Ok(settings);
    };
    if !settings.docked {
        return Ok(settings);
    }

    let monitor = monitor_for_saved_settings(&window, &settings)
        .ok_or_else(|| AppError::Message("无法确定容器窗口显示器".into()))?;
    settings.docked = false;
    settings.x = expanded_x(&side, &monitor, settings.width);
    settings.monitor_key = Some(key(&monitor));
    sanitize(&mut settings);
    schedule_window_state_save(app, id, settings.clone());
    window
        .set_position(Position::Physical(PhysicalPosition::new(
            settings.x, settings.y,
        )))
        .map_err(|error| AppError::Message(error.to_string()))?;
    apply_runtime(&window, &settings)?;
    Ok(settings)
}

pub fn dock(app: &AppHandle, id: &str) -> Result<ContainerWindowSettings, AppError> {
    let window = app
        .get_webview_window(&label_for(id))
        .ok_or_else(|| AppError::Message("容器窗口不可用".into()))?;
    let mut settings = layout_snapshot(app)?
        .windows
        .get(id)
        .cloned()
        .ok_or_else(|| AppError::Message("容器窗口布局不存在".into()))?;
    let Some(side) = settings.dock_side.clone() else {
        return Ok(settings);
    };
    if !settings.auto_hide || settings.docked {
        return Ok(settings);
    }

    let monitor = monitor_for_saved_settings(&window, &settings)
        .ok_or_else(|| AppError::Message("无法确定容器窗口显示器".into()))?;
    settings.docked = true;
    settings.x = hidden_x(&side, &monitor, settings.width);
    settings.monitor_key = Some(key(&monitor));
    sanitize(&mut settings);
    schedule_window_state_save(app, id, settings.clone());
    apply_dock_cursor_policy(&window, &settings);
    window
        .set_position(Position::Physical(PhysicalPosition::new(
            settings.x, settings.y,
        )))
        .map_err(|error| AppError::Message(error.to_string()))?;
    Ok(settings)
}

pub fn update_settings(
    app: &AppHandle,
    id: &str,
    mut settings: ContainerWindowSettings,
) -> Result<ContainerWindowSettings, AppError> {
    let window = app.get_webview_window(&label_for(id));
    if !settings.auto_hide && settings.docked {
        if let (Some(window), Some(side)) = (&window, settings.dock_side.clone()) {
            if let Some(monitor) = monitor_for_saved_settings(window, &settings) {
                settings.x = expanded_x(&side, &monitor, settings.width);
                settings.monitor_key = Some(key(&monitor));
            }
        }
        settings.docked = false;
        settings.dock_side = None;
    }

    sanitize(&mut settings);
    if let Some(window) = window {
        if settings.docked {
            if let (Some(side), Some(monitor)) = (
                settings.dock_side.as_deref(),
                monitor_for_saved_settings(&window, &settings),
            ) {
                settings.x = hidden_x(side, &monitor, settings.width);
                settings.monitor_key = Some(key(&monitor));
            }
        }
        let height = if settings.collapsed {
            COLLAPSED_HEIGHT
        } else {
            settings.expanded_height.max(settings.height)
        };
        if !settings.collapsed {
            settings.height = height;
            settings.expanded_height = height;
        }
        let target_size = PhysicalSize::new(settings.width, height);
        if window.inner_size().ok().as_ref() != Some(&target_size) {
            window
                .set_size(Size::Physical(target_size))
                .map_err(|error| AppError::Message(error.to_string()))?;
        }
        let target_position = PhysicalPosition::new(settings.x, settings.y);
        if window.outer_position().ok().as_ref() != Some(&target_position) {
            window
                .set_position(Position::Physical(target_position))
                .map_err(|error| AppError::Message(error.to_string()))?;
        }
        apply_runtime(&window, &settings)?;
        apply_dock_cursor_policy(&window, &settings);
    }

    schedule_window_state_save(app, id, settings.clone());
    Ok(settings)
}

pub fn update_opacity(
    app: &AppHandle,
    id: &str,
    opacity: u8,
) -> Result<ContainerWindowSettings, AppError> {
    let mut settings = settings(app, id)?;
    settings.opacity = opacity;
    sanitize(&mut settings);

    if let Some(window) = app.get_webview_window(&label_for(id)) {
        set_opacity(&window, settings.opacity)?;
    }

    schedule_window_state_save(app, id, settings.clone());
    Ok(settings)
}

pub fn hide(app: &AppHandle, id: &str) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window(&label_for(id)) {
        save_geometry(app, id, &window);
        window
            .hide()
            .map_err(|error| AppError::Message(error.to_string()))?;
    }
    Ok(())
}

pub fn show_all(app: &AppHandle) -> Result<(), AppError> {
    for (label, window) in app.webview_windows() {
        if label.starts_with(PREFIX) {
            window.unminimize().ok();
            window.show().ok();
        }
    }
    Ok(())
}

pub fn hide_all(app: &AppHandle) -> Result<(), AppError> {
    for (label, window) in app.webview_windows() {
        if let Some(id) = label.strip_prefix(PREFIX) {
            save_geometry(app, id, &window);
            window.hide().ok();
        }
    }
    Ok(())
}

pub async fn toggle_all(app: AppHandle) -> Result<(), AppError> {
    let any_visible = app
        .webview_windows()
        .into_iter()
        .any(|(label, window)| label.starts_with(PREFIX) && window.is_visible().unwrap_or(false));
    if any_visible {
        return hide_all(&app);
    }
    let data = app.state::<DataState>().read(&app)?;
    for container in data
        .containers
        .into_iter()
        .filter(|container| !container.hidden)
    {
        create_or_show(app.clone(), container.id).await?;
    }
    Ok(())
}

pub fn restore_mouse_interaction(app: &AppHandle) -> Result<(), AppError> {
    let mut state = layout_snapshot(app)?;
    for settings in state.windows.values_mut() { settings.click_through = false; }
    replace_layout_memory(app, state.clone())?;
    for (id, settings) in state.windows { schedule_window_state_save(app, &id, settings); }
    for (label, window) in app.webview_windows() {
        if label.starts_with(PREFIX) {
            window.set_ignore_cursor_events(false).ok();
        }
    }
    Ok(())
}

pub fn has_mouse_interaction_blocked(app: &AppHandle) -> Result<bool, AppError> {
    Ok(layout_snapshot(app)?
        .windows
        .values()
        .any(|settings| settings.click_through))
}

pub fn monitors(app: &AppHandle) -> Result<Vec<MonitorInfo>, AppError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::Message("主窗口不可用".into()))?;
    Ok(window
        .available_monitors()
        .map_err(|error| AppError::Message(error.to_string()))?
        .iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            MonitorInfo {
                key: key(monitor),
                name: monitor.name().cloned(),
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            }
        })
        .collect())
}

pub fn close_missing(app: &AppHandle, data: &AppData) {
    for (label, window) in app.webview_windows() {
        let Some(id) = label.strip_prefix(PREFIX) else {
            continue;
        };
        if !data.containers.iter().any(|container| container.id == id) {
            let _ = window.destroy();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversized_saved_geometry_is_kept_inside_the_work_area() {
        let mut settings = ContainerWindowSettings {
            x: 923,
            y: 404,
            width: 2_586,
            height: 1_626,
            expanded_height: 1_626,
            ..Default::default()
        };

        constrain_to_work_area(
            &mut settings,
            PhysicalPosition::new(0, 0),
            PhysicalSize::new(2_560, 1_528),
        );

        assert_eq!(settings.width, 2_560);
        assert_eq!(settings.height, 1_528);
        assert_eq!(settings.expanded_height, 1_528);
        assert_eq!((settings.x, settings.y), (0, 0));
    }

    #[test]
    fn old_layout_entries_default_dock_fields() {
        let settings: ContainerWindowSettings = serde_json::from_str(
            r#"{"monitorKey":null,"x":12,"y":24,"width":420,"height":360,"collapsed":false,"locked":false,"opacity":100,"clickThrough":false,"snapEdge":"none","autoHide":false,"layout":"grid","skipTaskbar":false,"allWorkspaces":false}"#,
        )
        .unwrap();

        assert!(!settings.docked);
        assert_eq!(settings.dock_side, None);
    }

    #[test]
    fn dock_coordinates_leave_a_ten_pixel_hot_zone() {
        assert_eq!(dock_x("left", 0, 1920, 420), -410);
        assert_eq!(dock_x("right", 0, 1920, 420), 1910);
        assert_eq!(dock_x("left", -1920, 1920, 420), -2330);
        assert_eq!(dock_x("right", -1920, 1920, 420), -10);
    }
}
