use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::{collections::HashSet, path::{Path, PathBuf}, sync::{Arc, Mutex}, time::Duration};
use tauri::{AppHandle, Emitter};

pub struct WatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    pending_paths: Arc<Mutex<HashSet<PathBuf>>>,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self { watcher: Mutex::new(None), pending_paths: Arc::new(Mutex::new(HashSet::new())) }
    }
}

pub fn configure(app: AppHandle, state: &WatcherState, enabled: bool) -> Result<(), String> {
    let mut guard = state
        .watcher
        .lock()
        .map_err(|_| "桌面监听状态不可用".to_string())?;
    *guard = None;
    if !enabled {
        return Ok(());
    }

    let desktop = dirs::desktop_dir().ok_or_else(|| "无法找到桌面文件夹".to_string())?;
    let app_for_event = app.clone();
    let pending_paths = state.pending_paths.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };
        if !matches!(event.kind, EventKind::Create(_)) {
            return;
        }
        for path in event.paths {
            if is_collectable(&path) {
                let key = path.clone();
                let queued = pending_paths.lock().map(|mut paths| paths.insert(key.clone())).unwrap_or(false);
                if !queued { continue; }
                let app = app_for_event.clone();
                let pending = pending_paths.clone();
                std::thread::spawn(move || {
                    // Explorer can emit several Create notifications while a .lnk is still being written.
                    std::thread::sleep(Duration::from_millis(500));
                    if let Ok(mut paths) = pending.lock() { paths.remove(&key); }
                    let _ = app.emit("desktop-file-created", key.to_string_lossy().to_string());
                });
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
