use crate::{models::AppData, storage, AppError};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::PathBuf};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const WINDOW_LABEL_PREFIX: &str = "container-";
const DEFAULT_WIDTH: f64 = 420.0;
const DEFAULT_HEIGHT: f64 = 360.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContainerWindowGeometry {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContainerWindowState {
    windows: BTreeMap<String, ContainerWindowGeometry>,
}

fn state_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let data_path = storage::data_path(app)?;
    Ok(data_path.with_file_name("deskbox-container-windows.json"))
}

fn load_state(app: &AppHandle) -> Result<ContainerWindowState, AppError> {
    let path = state_path(app)?;
    if !path.exists() {
        return Ok(ContainerWindowState::default());
    }

    let raw = fs::read_to_string(path)?;
    match serde_json::from_str(&raw) {
        Ok(state) => Ok(state),
        Err(error) => {
            eprintln!("DeskBox 容器窗口布局格式错误，已忽略：{error}");
            Ok(ContainerWindowState::default())
        }
    }
}

fn save_state(app: &AppHandle, state: &ContainerWindowState) -> Result<(), AppError> {
    let path = state_path(app)?;
    let temp = path.with_extension("tmp");
    fs::write(&temp, serde_json::to_vec_pretty(state)?)?;
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(temp, path)?;
    Ok(())
}

fn save_geometry(app: &AppHandle, container_id: &str, window: &WebviewWindow) {
    let result = (|| -> Result<(), AppError> {
        let position = window.outer_position().map_err(|error| AppError::Message(error.to_string()))?;
        let size = window.inner_size().map_err(|error| AppError::Message(error.to_string()))?;
        let mut state = load_state(app)?;
        state.windows.insert(
            container_id.to_string(),
            ContainerWindowGeometry {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            },
        );
        save_state(app, &state)
    })();

    if let Err(error) = result {
        eprintln!("DeskBox 未能保存容器窗口布局：{error}");
    }
}

fn default_position(app: &AppHandle) -> (f64, f64) {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return (140.0, 120.0);
    };
    let size = monitor.size();
    let position = monitor.position();
    let x = position.x + (size.width.saturating_sub(DEFAULT_WIDTH as u32) as i32 / 2) - 160;
    let y = position.y + (size.height.saturating_sub(DEFAULT_HEIGHT as u32) as i32 / 2) - 80;
    (x.max(position.x) as f64, y.max(position.y) as f64)
}

pub fn label_for(container_id: &str) -> String {
    format!("{WINDOW_LABEL_PREFIX}{container_id}")
}

pub async fn create_or_show(app: AppHandle, container_id: String) -> Result<(), AppError> {
    let data = storage::load(&storage::data_path(&app)?)?;
    let container = data
        .containers
        .iter()
        .find(|container| container.id == container_id)
        .ok_or_else(|| AppError::Message("容器不存在或已删除".to_string()))?;
    let label = label_for(&container_id);

    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|error| AppError::Message(error.to_string()))?;
        window.set_focus().map_err(|error| AppError::Message(error.to_string()))?;
        return Ok(());
    }

    let saved_geometry = load_state(&app)?.windows.get(&container_id).cloned();
    let (default_x, default_y) = default_position(&app);
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title(format!("DeskBox - {}", container.name))
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .resizable(true)
        .min_inner_size(280.0, 220.0)
        .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
        .position(140.0, 120.0)
        .visible(false)
        .build()
        .map_err(|error| AppError::Message(error.to_string()))?;

    if let Some(geometry) = saved_geometry {
        window
            .set_size(PhysicalSize::new(geometry.width, geometry.height))
            .map_err(|error| AppError::Message(error.to_string()))?;
        window
            .set_position(PhysicalPosition::new(geometry.x, geometry.y))
            .map_err(|error| AppError::Message(error.to_string()))?;
    } else {
        window
            .set_position(PhysicalPosition::new(default_x as i32, default_y as i32))
            .map_err(|error| AppError::Message(error.to_string()))?;
    }

    let app_for_events = app.clone();
    let container_id_for_events = container_id.clone();
    let window_for_events = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window_for_events.hide();
        }
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            save_geometry(&app_for_events, &container_id_for_events, &window_for_events);
        }
        _ => {}
    });

    window.show().map_err(|error| AppError::Message(error.to_string()))?;
    window.set_focus().map_err(|error| AppError::Message(error.to_string()))?;
    Ok(())
}

pub fn hide(app: &AppHandle, container_id: &str) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window(&label_for(container_id)) {
        window.hide().map_err(|error| AppError::Message(error.to_string()))?;
    }
    Ok(())
}

pub fn close_missing(app: &AppHandle, data: &AppData) {
    for (label, window) in app.webview_windows() {
        let Some(container_id) = label.strip_prefix(WINDOW_LABEL_PREFIX) else { continue };
        if !data.containers.iter().any(|container| container.id == container_id) {
            let _ = window.destroy();
        }
    }
}
