mod app_state;
mod commands;
mod container_windows;
mod icons;
mod hotkeys;
mod launcher;
mod everything_ipc;
mod models;
mod operations;
mod storage;
mod watcher;
mod wallpaper;

use app_state::{DataState, HotkeyRuntime, RuntimeStatus};
use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::ShortcutState;
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
    where
        S: serde::Serializer,
    {
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

pub(crate) fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    match window.is_visible() {
        Ok(true) => {
            let _ = window.hide();
        }
        _ => show_main_window(app),
    }
}

pub(crate) fn toggle_quick_launch(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("quick-launch") else {
        return;
    };
    match window.is_visible() {
        Ok(true) => {
            let _ = window.hide();
        }
        _ => {
            let _ = window.center();
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit("quick-launch-reset", ());
        }
    }
}

fn build_quick_launch(app: &tauri::App) -> tauri::Result<()> {
    let window =
        WebviewWindowBuilder::new(app, "quick-launch", WebviewUrl::App("index.html".into()))
            .title("DeskBox 快速启动")
            .inner_size(720.0, 520.0)
            .min_inner_size(720.0, 520.0)
            .max_inner_size(720.0, 520.0)
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
        WindowEvent::Focused(false) => {
            let _ = window_for_events.hide();
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window_for_events.hide();
        }
        _ => {}
    });
    Ok(())
}

pub(crate) fn show_settings_window(app: &tauri::AppHandle) {
    show_main_window(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("open-settings", ());
    }
}

pub(crate) fn toggle_settings_window(app: &tauri::AppHandle) {
    show_settings_window(app);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app)
        }))
        .manage(DataState::default())
        .manage(RuntimeStatus::default())
        .manage(HotkeyRuntime::default())
        .manage(icons::IconCacheState::default())
        .manage(container_windows::WindowLayoutState::default())
        .manage(launcher::SystemCatalogState::default())
        .manage(everything_ipc::EverythingState::default())
        .manage(WatcherState::default())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    hotkeys::handle(app, shortcut);
                })
                .build(),
        )
        .setup(|app| {
            build_quick_launch(app)?;
            if let Err(error) = app.state::<DataState>().read(app.handle()) {
                eprintln!("DeskBox 数据初始化失败：{error}");
            }
            if let Err(error) = hotkeys::register_startup(app.handle()) {
                let message = error.to_string();
                eprintln!("{message}");
                if let Ok(mut status) = app.state::<RuntimeStatus>().0.lock() { *status = Some(message); }
            }

            let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏", true, None::<&str>)?;
            let quick = MenuItem::with_id(app, "quick", "快速启动", true, None::<&str>)?;
            let restore_mouse = MenuItem::with_id(app, "restore-mouse", "恢复悬浮窗鼠标交互", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出 DeskBox", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &quick, &restore_mouse, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("应用图标缺失").clone())
                .tooltip("DeskBox")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle_main_window(app),
                    "quick" => toggle_quick_launch(app),
                    "restore-mouse" => { let _ = container_windows::restore_mouse_interaction(app); }
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
            commands::get_container_window_settings,
            commands::update_container_window_settings,
            commands::update_container_window_opacity,
            commands::show_all_container_windows,
            commands::hide_all_container_windows,
            commands::toggle_all_container_windows,
            commands::list_monitors,
            commands::set_container_window_pinned,
            commands::restore_container_mouse_interaction,
            commands::has_container_mouse_interaction_blocked,
            commands::reveal_container_window_dock,
            commands::dock_container_window,
            commands::get_wallpaper_dominant_color,
            commands::show_quick_launch,
            commands::show_settings_window,
            commands::pick_shortcut_path,
            commands::pick_background_media,
            commands::delete_background_asset,
            commands::extract_icon,
            commands::resolve_shortcut,
            commands::is_directory,
            commands::get_file_name,
            commands::launch_path,
            commands::launch_shortcut,
            commands::reveal_in_explorer,
            commands::configure_desktop_watcher,
            commands::recycle_source,
            commands::hide_path,
            commands::show_path,
            commands::toggle_path_hidden,
            commands::get_path_hidden,
            commands::hide_paths,
            commands::show_paths,
            commands::export_backup,
            commands::import_backup,
            commands::open_backup_directory,
            commands::get_runtime_status,
            hotkeys::set_hotkey_binding,
            hotkeys::get_hotkey_statuses,
            launcher::get_system_app_catalog,
            launcher::refresh_system_app_catalog,
            launcher::launch_external_item,
            everything_ipc::detect_everything,
            everything_ipc::search_everything,
        ])
        .build(tauri::generate_context!())
        .expect("DeskBox 初始化失败")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let _ = app.state::<DataState>().flush(app);
                let _ = container_windows::flush(app);
            }
        });
}
