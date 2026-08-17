use crate::{storage, AppError};
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    thread,
    time::Instant,
};

const CACHE_LIMIT: usize = 200;

#[derive(Default)]
struct IconCache {
    values: HashMap<String, String>,
    lru: VecDeque<String>,
    in_flight: HashSet<String>,
}

#[derive(Default)]
pub struct IconCacheState(Mutex<IconCache>);

impl IconCacheState {
    fn get(&self, key: &str) -> Option<String> {
        let mut cache = self.0.lock().ok()?;
        let value = cache.values.get(key).cloned()?;
        if let Some(index) = cache.lru.iter().position(|item| item == key) { cache.lru.remove(index); }
        cache.lru.push_back(key.to_string());
        Some(value)
    }

    fn begin(&self, key: &str) -> bool {
        loop {
            let mut cache = match self.0.lock() { Ok(cache) => cache, Err(_) => return false };
            if cache.values.contains_key(key) { return false; }
            if cache.in_flight.insert(key.to_string()) { return true; }
            drop(cache);
            thread::sleep(std::time::Duration::from_millis(12));
        }
    }

    fn finish(&self, key: &str, value: Option<String>) {
        if let Ok(mut cache) = self.0.lock() {
            cache.in_flight.remove(key);
            if let Some(value) = value {
                cache.values.insert(key.to_string(), value);
                if let Some(index) = cache.lru.iter().position(|item| item == key) { cache.lru.remove(index); }
                cache.lru.push_back(key.to_string());
                while cache.lru.len() > CACHE_LIMIT {
                    if let Some(stale) = cache.lru.pop_front() { cache.values.remove(&stale); }
                }
            }
        }
    }
}

fn cache_path(app: &tauri::AppHandle, source: &str) -> Result<PathBuf, AppError> {
    let hash = Sha256::digest(source.to_lowercase().as_bytes());
    Ok(storage::icon_cache_dir(app)?.join(format!("{:x}.png", hash)))
}

fn as_data_uri(path: &Path) -> Result<String, AppError> {
    let bytes = fs::read(path)?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

fn prune_disk_cache(app: &tauri::AppHandle) -> Result<(), AppError> {
    let mut entries: Vec<_> = fs::read_dir(storage::icon_cache_dir(app)?)?
        .flatten()
        .filter(|entry| entry.path().extension().and_then(|value| value.to_str()) == Some("png"))
        .collect();
    entries.sort_by_key(|entry| entry.metadata().and_then(|metadata| metadata.modified()).ok());
    let excess = entries.len().saturating_sub(CACHE_LIMIT);
    for entry in entries.into_iter().take(excess) {
        let _ = fs::remove_file(entry.path());
    }
    Ok(())
}

#[cfg(windows)]
pub fn extract(app: &tauri::AppHandle, state: &IconCacheState, source: &str) -> Result<Option<String>, AppError> {
    let started = Instant::now();
    if let Some(icon) = state.get(source) {
        #[cfg(debug_assertions)]
        eprintln!("[deskbox:perf] icon cache=memory total={}ms", started.elapsed().as_millis());
        return Ok(Some(icon));
    }
    if !state.begin(source) { return Ok(state.get(source)); }
    let cache = match cache_path(app, source) {
        Ok(cache) => cache,
        Err(error) => {
            state.finish(source, None);
            return Err(error);
        }
    };
    if cache.exists() {
        let icon = match as_data_uri(&cache) {
            Ok(icon) => icon,
            Err(error) => {
                state.finish(source, None);
                return Err(error);
            }
        };
        state.finish(source, Some(icon.clone()));
        #[cfg(debug_assertions)]
        eprintln!("[deskbox:perf] icon cache=disk total={}ms", started.elapsed().as_millis());
        return Ok(Some(icon));
    }

    // 使用 Windows 自带的关联图标提取能力，缓存为 PNG 后复用。
    let script = r#"
$source = $env:DESKBOX_ICON_SOURCE
$target = $env:DESKBOX_ICON_TARGET
Add-Type -AssemblyName System.Drawing
$resolved = $source
if (-not [System.IO.Path]::IsPathRooted($resolved)) {
  $command = Get-Command $resolved -ErrorAction SilentlyContinue
  if ($command) { $resolved = $command.Source }
}
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($resolved)
if ($null -ne $icon) {
  $bitmap = $icon.ToBitmap()
  $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  $icon.Dispose()
}
"#;
    let output = match Command::new("powershell.exe")
        .env("DESKBOX_ICON_SOURCE", source)
        .env("DESKBOX_ICON_TARGET", &cache)
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output() {
        Ok(output) => output,
        Err(error) => {
            state.finish(source, None);
            return Err(error.into());
        }
    };

    if output.status.success() && cache.exists() {
        let icon = match as_data_uri(&cache) {
            Ok(icon) => icon,
            Err(error) => {
                state.finish(source, None);
                return Err(error);
            }
        };
        let _ = prune_disk_cache(app);
        state.finish(source, Some(icon.clone()));
        #[cfg(debug_assertions)]
        eprintln!("[deskbox:perf] icon cache=miss total={}ms", started.elapsed().as_millis());
        Ok(Some(icon))
    } else {
        state.finish(source, None);
        Ok(None)
    }
}

#[cfg(not(windows))]
pub fn extract(_app: &tauri::AppHandle, _state: &IconCacheState, _source: &str) -> Result<Option<String>, AppError> {
    Ok(None)
}
