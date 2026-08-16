use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{path::Path, sync::Mutex};
use tauri::{AppHandle, Emitter};

pub struct WatcherState(pub Mutex<Option<RecommendedWatcher>>);

impl Default for WatcherState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

pub fn configure(app: AppHandle, state: &WatcherState, enabled: bool) -> Result<(), String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "桌面监听状态不可用".to_string())?;
    *guard = None;
    if !enabled {
        return Ok(());
    }

    let desktop = dirs::desktop_dir().ok_or_else(|| "无法找到桌面文件夹".to_string())?;
    let app_for_event = app.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };
        if !matches!(event.kind, EventKind::Create(_)) {
            return;
        }
        for path in event.paths {
            if is_collectable(&path) {
                // 前端负责去重、归类和保存，监听器只报告新文件。
                let _ =
                    app_for_event.emit("desktop-file-created", path.to_string_lossy().to_string());
            }
        }
    })
    .map_err(|error| error.to_string())?;

    watcher
        .watch(&desktop, RecursiveMode::NonRecursive)
        .map_err(|error| error.to_string())?;
    *guard = Some(watcher);
    Ok(())
}

fn is_collectable(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            extension.eq_ignore_ascii_case("lnk") || extension.eq_ignore_ascii_case("exe")
        })
        .unwrap_or(false)
}
