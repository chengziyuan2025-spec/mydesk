mod app_state;
mod commands;
mod container_windows;
mod icons;
mod models;
mod operations;
mod storage;
mod watcher;

use app_state::{DataState, RuntimeStatus};
use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, ShortcutState};
use thiserror::Error;
use watcher::WatcherState;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error("文件操作失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("数据保存失败：{0}")]
    Json(#[from] serde_json::Error),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: serde::Serializer {
        serializer.serialize_str(&self.to_string())
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    match window.is_visible() {
        Ok(true) => { let _ = window.hide(); }
        _ => show_main_window(app),
    }
}

fn toggle_quick_launch(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("quick-launch") else { return };
    match window.is_visible() {
        Ok(true) => { let _ = window.hide(); }
        _ => {
            let _ = window.center();
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit("quick-launch-reset", ());
        }
    }
}

fn build_quick_launch(app: &tauri::App) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, "quick-launch", WebviewUrl::App("index.html".into()))
        .title("DeskBox 快速启动")
        .inner_size(680.0, 460.0)
        .min_inner_size(680.0, 460.0)
        .max_inner_size(680.0, 460.0)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .center()
        .visible(false)
        .build()?;
    let window_for_events = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(false) => { let _ = window_for_events.hide(); }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window_for_events.hide();
        }
        _ => {}
    });
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main_window(app)))
        .manage(DataState::default())
        .manage(RuntimeStatus::default())
        .manage(WatcherState::default())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed { return; }
                    if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyH) {
                        toggle_main_window(app);
                    } else if shortcut.matches(Modifiers::ALT, Code::Space) {
                        toggle_quick_launch(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            build_quick_launch(app)?;
            app.global_shortcut().register("Ctrl+Shift+H")?;
            if let Err(error) = app.global_shortcut().register("Alt+Space") {
                let message = format!("Alt+Space 注册失败：{error}。仍可从主页打开快速启动。");
                eprintln!("{message}");
                if let Ok(mut status) = app.state::<RuntimeStatus>().0.lock() {
                    *status = Some(message);
                }
            }

            let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏", true, None::<&str>)?;
            let quick = MenuItem::with_id(app, "quick", "快速启动", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出 DeskBox", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &quick, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("应用图标缺失").clone())
                .tooltip("DeskBox")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle_main_window(app),
                    "quick" => toggle_quick_launch(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let window_to_hide = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_to_hide.hide();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_app_data,
            commands::apply_app_operation,
            commands::create_container_window,
            commands::hide_container_window,
            commands::show_quick_launch,
            commands::pick_shortcut_path,
            commands::extract_icon,
            commands::launch_path,
            commands::launch_shortcut,
            commands::reveal_in_explorer,
            commands::configure_desktop_watcher,
            commands::recycle_source,
            commands::export_backup,
            commands::import_backup,
            commands::open_backup_directory,
            commands::get_runtime_status,
        ])
        .run(tauri::generate_context!())
        .expect("DeskBox 启动失败");
}
