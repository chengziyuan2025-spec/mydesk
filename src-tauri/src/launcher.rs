use crate::{commands, models::LaunchTargetType, AppError};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::{Path, PathBuf}, process::Command, sync::Mutex, time::{Duration, Instant}};
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemAppCatalogItem {
    pub key: String,
    pub name: String,
    pub target_type: LaunchTargetType,
    pub target: String,
    pub source_path: Option<String>,
    pub icon: Option<String>,
}

#[derive(Default)]
pub struct SystemCatalogState(pub Mutex<Option<(Instant, Vec<SystemAppCatalogItem>)>>);

fn walk_links(root: &Path, output: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else { return; };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() { walk_links(&path, output); }
        else if path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("lnk")) { output.push(path); }
    }
}

#[cfg(windows)]
fn scan_catalog() -> Vec<SystemAppCatalogItem> {
    let mut links = Vec::new();
    if let Ok(path) = std::env::var("APPDATA") { walk_links(&Path::new(&path).join("Microsoft\\Windows\\Start Menu\\Programs"), &mut links); }
    if let Ok(path) = std::env::var("PROGRAMDATA") { walk_links(&Path::new(&path).join("Microsoft\\Windows\\Start Menu\\Programs"), &mut links); }
    let mut items = Vec::new();
    let mut names = HashSet::new();
    let mut targets = HashSet::new();
    for path in links {
        let name = path.file_stem().map(|value| value.to_string_lossy().to_string()).unwrap_or_default();
        if name.is_empty() { continue; }
        let target = path.to_string_lossy().to_string();
        if !targets.insert(target.to_lowercase()) { continue; }
        let key = format!("system:lnk:{}", target.to_lowercase());
        names.insert(name.to_lowercase());
        items.push(SystemAppCatalogItem { key, name, target_type: LaunchTargetType::Path, target: target.clone(), source_path: Some(target), icon: None });
    }

    // Get-StartApps is a fixed OS inventory command. No user text is interpolated into the script.
    let script = "Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress";
    if let Ok(output) = Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", script]).output() {
        if output.status.success() {
            let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap_or(serde_json::Value::Null);
            let rows: Vec<&serde_json::Value> = match &value { serde_json::Value::Array(values) => values.iter().collect(), serde_json::Value::Object(_) => vec![&value], _ => Vec::new() };
            for row in rows {
                let Some(name) = row.get("Name").and_then(|value| value.as_str()).map(str::trim).filter(|value| !value.is_empty()) else { continue; };
                let Some(app_id) = row.get("AppID").and_then(|value| value.as_str()).map(str::trim).filter(|value| !value.is_empty()) else { continue; };
                if names.contains(&name.to_lowercase()) { continue; }
                let direct = Path::new(app_id);
                let (target_type, source_path) = if direct.is_absolute() && direct.exists() { (LaunchTargetType::Path, Some(app_id.to_string())) } else { (LaunchTargetType::ShellApp, None) };
                items.push(SystemAppCatalogItem { key: format!("system:app:{}", app_id.to_lowercase()), name: name.to_string(), target_type, target: app_id.to_string(), source_path, icon: None });
            }
        }
    }
    items.sort_by_key(|item| item.name.to_lowercase());
    items
}

#[cfg(not(windows))]
fn scan_catalog() -> Vec<SystemAppCatalogItem> { Vec::new() }

pub fn catalog(_app: &AppHandle, state: &SystemCatalogState, refresh: bool) -> Vec<SystemAppCatalogItem> {
    if !refresh {
        if let Ok(cache) = state.0.lock() {
            if let Some((created, items)) = cache.as_ref() { if created.elapsed() < Duration::from_secs(300) { return items.clone(); } }
        }
    }
    let items = scan_catalog();
    if let Ok(mut cache) = state.0.lock() { *cache = Some((Instant::now(), items.clone())); }
    items
}

#[tauri::command]
pub fn get_system_app_catalog(app: AppHandle, state: State<SystemCatalogState>, refresh: Option<bool>) -> Vec<SystemAppCatalogItem> {
    catalog(&app, &state, refresh.unwrap_or(false))
}

#[tauri::command]
pub fn refresh_system_app_catalog(app: AppHandle, state: State<SystemCatalogState>) -> Vec<SystemAppCatalogItem> {
    catalog(&app, &state, true)
}

pub fn is_catalog_shell_app(app: &AppHandle, state: &SystemCatalogState, target: &str) -> bool {
    catalog(app, state, false).iter().any(|item| item.target_type == LaunchTargetType::ShellApp && item.target == target)
}

#[tauri::command]
pub fn launch_external_item(app: AppHandle, state: State<SystemCatalogState>, target_type: LaunchTargetType, target: String) -> Result<(), AppError> {
    match target_type {
        LaunchTargetType::Path | LaunchTargetType::Url => commands::launch_target(&target, None, None),
        LaunchTargetType::ShellApp => {
            if !is_catalog_shell_app(&app, &state, &target) {
                return Err(AppError::Message("系统应用标识不在当前应用目录中".into()));
            }
            commands::launch_shell_app(&target)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ignores_missing_start_menu() { let mut values = Vec::new(); walk_links(Path::new("Z:\\deskbox-missing"), &mut values); assert!(values.is_empty()); }
    #[cfg(windows)]
    #[test]
    fn scans_windows_application_catalog() {
        let items = scan_catalog();
        assert!(!items.is_empty());
        assert!(items.iter().any(|item| item.name.contains("计算器") || item.name.to_lowercase().contains("calculator")));
    }
}
