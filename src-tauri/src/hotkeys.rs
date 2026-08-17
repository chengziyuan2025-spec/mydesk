use crate::{
    app_state::{DataState, HotkeyRuntime, HotkeyStatus}, container_windows, AppError,
};
use std::{collections::HashSet, str::FromStr};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

const RESTORE_MOUSE: &str = "Ctrl+Shift+M";

fn canonical(value: &str) -> Result<String, AppError> {
    Shortcut::from_str(value.trim()).map(|shortcut| shortcut.to_string())
        .map_err(|_| AppError::Message("快捷键格式无效，请同时按下修饰键和一个按键".into()))
}

fn configured(data: &crate::models::AppData) -> Vec<(String, Option<String>)> {
    let mut values = vec![
        ("mainWindow".into(), data.settings.hotkeys.main_window.clone()),
        ("quickLaunch".into(), data.settings.hotkeys.quick_launch.clone()),
        ("toggleContainers".into(), data.settings.hotkeys.toggle_containers.clone()),
        ("settings".into(), data.settings.hotkeys.settings.clone()),
    ];
    values.extend(data.containers.iter().map(|item| (format!("container:{}", item.id), item.hotkey.clone())));
    values
}

fn update_status(runtime: &HotkeyRuntime, status: HotkeyStatus) {
    if let Ok(mut statuses) = runtime.0.lock() { statuses.insert(status.action.clone(), status); }
}

pub fn register_startup(app: &AppHandle) -> Result<(), AppError> {
    let runtime = app.state::<HotkeyRuntime>();
    if let Err(error) = app.global_shortcut().register(RESTORE_MOUSE) {
        eprintln!("恢复鼠标交互快捷键注册失败：{error}");
    }
    let data = app.state::<DataState>().read(app)?;
    let mut seen = HashSet::new();
    seen.insert(canonical(RESTORE_MOUSE)?);
    for (action, accelerator) in configured(&data) {
        let Some(value) = accelerator.clone() else {
            update_status(&runtime, HotkeyStatus { action, accelerator: None, state: "unassigned".into(), message: None });
            continue;
        };
        let parsed = match canonical(&value) {
            Ok(value) => value,
            Err(error) => {
                update_status(&runtime, HotkeyStatus { action, accelerator: Some(value), state: "invalid".into(), message: Some(error.to_string()) });
                continue;
            }
        };
        if !seen.insert(parsed.clone()) {
            update_status(&runtime, HotkeyStatus { action, accelerator: Some(value), state: "conflict".into(), message: Some("与 DeskBox 的其他快捷键冲突".into()) });
            continue;
        }
        match app.global_shortcut().register(parsed.as_str()) {
            Ok(()) => update_status(&runtime, HotkeyStatus { action, accelerator: Some(parsed), state: "active".into(), message: None }),
            Err(error) => update_status(&runtime, HotkeyStatus { action, accelerator: Some(value), state: "conflict".into(), message: Some(format!("快捷键已被其他应用占用：{error}")) }),
        }
    }
    Ok(())
}

pub fn handle(app: &AppHandle, pressed: &Shortcut) {
    let pressed = pressed.to_string();
    if canonical(RESTORE_MOUSE).ok().as_deref() == Some(pressed.as_str()) {
        let _ = container_windows::restore_mouse_interaction(app);
        return;
    }
    let Ok(data) = app.state::<DataState>().read(app) else { return; };
    for (action, accelerator) in configured(&data) {
        let matches = accelerator.as_deref().and_then(|value| canonical(value).ok()).as_deref() == Some(pressed.as_str());
        if !matches { continue; }
        match action.as_str() {
            "mainWindow" => crate::toggle_main_window(app),
            "quickLaunch" => crate::toggle_quick_launch(app),
            "toggleContainers" => { let app = app.clone(); tauri::async_runtime::spawn(async move { let _ = container_windows::toggle_all(app).await; }); },
            "settings" => crate::toggle_settings_window(app),
            value if value.starts_with("container:") => {
                let id = value.trim_start_matches("container:").to_string();
                let app = app.clone();
                tauri::async_runtime::spawn(async move { let _ = container_windows::create_or_show(app, id).await; });
            }
            _ => {}
        }
        break;
    }
}

fn binding(data: &crate::models::AppData, action: &str) -> Result<Option<String>, AppError> {
    match action {
        "mainWindow" => Ok(data.settings.hotkeys.main_window.clone()),
        "quickLaunch" => Ok(data.settings.hotkeys.quick_launch.clone()),
        "toggleContainers" => Ok(data.settings.hotkeys.toggle_containers.clone()),
        "settings" => Ok(data.settings.hotkeys.settings.clone()),
        value if value.starts_with("container:") => data.containers.iter().find(|item| item.id == value.trim_start_matches("container:"))
            .map(|item| item.hotkey.clone()).ok_or_else(|| AppError::Message("容器不存在".into())),
        _ => Err(AppError::Message("未知快捷键动作".into())),
    }
}

fn set_binding(data: &mut crate::models::AppData, action: &str, value: Option<String>) -> Result<(), AppError> {
    match action {
        "mainWindow" => data.settings.hotkeys.main_window = value,
        "quickLaunch" => data.settings.hotkeys.quick_launch = value,
        "toggleContainers" => data.settings.hotkeys.toggle_containers = value,
        "settings" => data.settings.hotkeys.settings = value,
        action if action.starts_with("container:") => data.containers.iter_mut().find(|item| item.id == action.trim_start_matches("container:"))
            .ok_or_else(|| AppError::Message("容器不存在".into()))?.hotkey = value,
        _ => return Err(AppError::Message("未知快捷键动作".into())),
    }
    Ok(())
}

#[tauri::command]
pub fn set_hotkey_binding(app: AppHandle, state: State<DataState>, runtime: State<HotkeyRuntime>, action: String, accelerator: Option<String>) -> Result<crate::models::AppData, AppError> {
    let current = state.read(&app)?;
    let old = binding(&current, &action)?;
    let next = accelerator.as_deref().map(canonical).transpose()?;
    if next.as_deref() == Some(canonical(RESTORE_MOUSE)?.as_str()) { return Err(AppError::Message(format!("{RESTORE_MOUSE} 已保留用于恢复悬浮窗鼠标交互"))); }
    if let Some(value) = &next {
        for (other_action, other) in configured(&current) {
            if other_action != action && other.as_deref().and_then(|item| canonical(item).ok()).as_deref() == Some(value.as_str()) {
                return Err(AppError::Message(format!("{value} 已绑定到 {other_action}")));
            }
        }
        if old.as_deref().and_then(|item| canonical(item).ok()).as_deref() != Some(value.as_str()) {
            app.global_shortcut().register(value.as_str()).map_err(|error| AppError::Message(format!("{value} 已被其他应用占用：{error}")))?;
        }
    }
    let action_for_update = action.clone();
    let next_for_update = next.clone();
    let data = match state.mutate(&app, move |data| {
        set_binding(data, &action_for_update, next_for_update)?;
        data.revision = data.revision.saturating_add(1);
        Ok(())
    }) {
        Ok((data, _)) => data,
        Err(error) => {
        if let Some(value) = &next { if old.as_deref().and_then(|item| canonical(item).ok()).as_deref() != Some(value) { let _ = app.global_shortcut().unregister(value.as_str()); } }
            return Err(error);
        }
    };
    if let Some(old_value) = old.as_deref().and_then(|value| canonical(value).ok()) { if next.as_deref() != Some(old_value.as_str()) { let _ = app.global_shortcut().unregister(old_value.as_str()); } }
    update_status(&runtime, HotkeyStatus { action: action.clone(), accelerator: next.clone(), state: if next.is_some() { "active".into() } else { "unassigned".into() }, message: None });
    crate::commands::emit_data_changed(&app, data.revision, None)?;
    Ok(data)
}

#[tauri::command]
pub fn get_hotkey_statuses(runtime: State<HotkeyRuntime>) -> Result<Vec<HotkeyStatus>, AppError> {
    runtime.0.lock().map(|items| items.values().cloned().collect()).map_err(|_| AppError::Message("快捷键状态不可用".into()))
}

pub fn unregister(app: &AppHandle, accelerator: &str) { if let Ok(value) = canonical(accelerator) { let _ = app.global_shortcut().unregister(value.as_str()); } }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn canonicalizes_accelerators() { assert_eq!(canonical("ctrl+shift+h").unwrap(), canonical("Shift+Control+KeyH").unwrap()); }
    #[test]
    fn rejects_invalid_accelerators() { assert!(canonical("Ctrl+").is_err()); }
}
