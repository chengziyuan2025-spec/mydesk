use crate::{
    models::{sanitize_appearance, AppData, TrashEntry, CURRENT_DATA_VERSION},
    AppError,
};
use chrono::Local;
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub fn data_path(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Message(error.to_string()))?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("deskbox-data.json"))
}

pub fn backup_dir(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let dir = data_path(app)?.with_file_name("backups");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn icon_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| AppError::Message(error.to_string()))?
        .join("icons");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn background_assets_dir(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let dir = data_path(app)?.with_file_name("assets");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn timestamp() -> String {
    Local::now().format("%Y%m%d-%H%M%S-%3f").to_string()
}

fn backup_file(path: &Path, label: &str) -> Result<Option<PathBuf>, AppError> {
    if !path.exists() {
        return Ok(None);
    }
    let directory = path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("backups");
    fs::create_dir_all(&directory)?;
    let target = directory.join(format!("{label}-{}.json", timestamp()));
    fs::copy(path, &target)?;
    Ok(Some(target))
}

fn visit_container_shortcuts(
    container: &mut Value,
    visit: &mut dyn FnMut(&mut serde_json::Map<String, Value>),
) {
    if let Some(shortcuts) = container.get_mut("shortcuts").and_then(Value::as_array_mut) {
        for shortcut in shortcuts {
            if let Some(shortcut) = shortcut.as_object_mut() {
                visit(shortcut);
            }
        }
    }
}

fn visit_all_shortcuts(
    value: &mut Value,
    visit: &mut dyn FnMut(&mut serde_json::Map<String, Value>),
) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    if let Some(containers) = object.get_mut("containers").and_then(Value::as_array_mut) {
        for container in containers {
            visit_container_shortcuts(container, visit);
        }
    }
    if let Some(trash) = object.get_mut("trash").and_then(Value::as_array_mut) {
        for entry in trash {
            let Some(entry) = entry.as_object_mut() else {
                continue;
            };
            match entry.get("kind").and_then(Value::as_str) {
                Some("shortcut") => {
                    if let Some(item) = entry.get_mut("item").and_then(Value::as_object_mut) {
                        visit(item);
                    }
                }
                Some("container") => {
                    if let Some(item) = entry.get_mut("item") {
                        visit_container_shortcuts(item, visit);
                    }
                }
                _ => {}
            }
        }
    }
}

fn visit_all_containers(value: &mut Value, visit: &mut dyn FnMut(&mut serde_json::Map<String, Value>)) {
    let Some(object) = value.as_object_mut() else { return; };
    if let Some(containers) = object.get_mut("containers").and_then(Value::as_array_mut) {
        for container in containers { if let Some(container) = container.as_object_mut() { visit(container); } }
    }
    if let Some(trash) = object.get_mut("trash").and_then(Value::as_array_mut) {
        for entry in trash {
            let Some(entry) = entry.as_object_mut() else { continue; };
            if entry.get("kind").and_then(Value::as_str) == Some("container") {
                if let Some(container) = entry.get_mut("item").and_then(Value::as_object_mut) { visit(container); }
            }
        }
    }
}

fn migrate_value(mut value: Value) -> Result<(Value, bool), AppError> {
    let version = value.get("version").and_then(Value::as_u64).unwrap_or(1) as u32;
    if version > CURRENT_DATA_VERSION {
        return Err(AppError::Message(format!(
            "数据版本 {version} 高于当前支持的版本 {CURRENT_DATA_VERSION}，已保留原文件"
        )));
    }
    let mut migrated = false;
    if version < 2 {
        let object = value
            .as_object_mut()
            .ok_or_else(|| AppError::Message("数据根节点必须是对象".to_string()))?;
        object.insert("version".to_string(), json!(2));
        object.entry("revision".to_string()).or_insert(json!(0));
        object.entry("trash".to_string()).or_insert(json!([]));
        visit_all_shortcuts(&mut value, &mut |item| {
            item.entry("launchCount".to_string()).or_insert(json!(0));
            item.entry("lastLaunchedAt".to_string())
                .or_insert(Value::Null);
        });
        migrated = true;
    }
    if version < 3 {
        let object = value
            .as_object_mut()
            .ok_or_else(|| AppError::Message("数据根节点必须是对象".to_string()))?;
        object.insert("version".to_string(), json!(3));

        visit_all_shortcuts(&mut value, &mut |item| {
            item.entry("source".to_string()).or_insert(json!("manual"));
            item.entry("arguments".to_string()).or_insert(Value::Null);
            item.entry("workingDirectory".to_string())
                .or_insert(Value::Null);
        });
        migrated = true;
    }
    if version < 4 {
        let object = value.as_object_mut().ok_or_else(|| AppError::Message("数据根节点必须是对象".to_string()))?;
        object.insert("version".to_string(), json!(4));
        object.entry("externalLauncherEntries".to_string()).or_insert(json!([]));
        if let Some(settings) = object.get_mut("settings").and_then(Value::as_object_mut) {
            settings.entry("hotkeys".to_string()).or_insert(json!({
                "mainWindow": "Ctrl+Shift+H", "quickLaunch": "Alt+Space", "toggleContainers": null
            }));
            settings.entry("everything".to_string()).or_insert(json!({ "enabled": false, "executablePath": null }));
        }
        visit_all_containers(&mut value, &mut |container| {
            container.entry("aliases".to_string()).or_insert(json!([]));
            container.entry("favorite".to_string()).or_insert(json!(false));
            container.entry("openCount".to_string()).or_insert(json!(0));
            container.entry("lastOpenedAt".to_string()).or_insert(Value::Null);
            container.entry("hotkey".to_string()).or_insert(Value::Null);
        });
        visit_all_shortcuts(&mut value, &mut |item| {
            let target_type = item.get("path").and_then(Value::as_str)
                .map(|path| if path.starts_with("http://") || path.starts_with("https://") { "url" } else { "path" })
                .unwrap_or("path");
            item.entry("targetType".to_string()).or_insert(json!(target_type));
            item.entry("aliases".to_string()).or_insert(json!([]));
            item.entry("favorite".to_string()).or_insert(json!(false));
            item.entry("sourcePath".to_string()).or_insert(Value::Null);
        });
        migrated = true;
    }
    if version < 5 {
        let object = value.as_object_mut().ok_or_else(|| AppError::Message("数据根节点必须是对象".to_string()))?;
        object.insert("version".to_string(), json!(5));
        if let Some(settings) = object.get_mut("settings").and_then(Value::as_object_mut) {
            settings.entry("appearance".to_string()).or_insert(json!({
                "accentColor": null,
                "background": { "kind": "none", "assetPath": null, "assetName": null, "overlay": 34 }
            }));
        }
        migrated = true;
    }
    if version < 6 {
        let object = value.as_object_mut().ok_or_else(|| AppError::Message("数据根节点必须是对象".to_string()))?;
        object.insert("version".to_string(), json!(6));
        if let Some(settings) = object.get_mut("settings").and_then(Value::as_object_mut) {
            let hotkeys = settings.entry("hotkeys".to_string()).or_insert(json!({}));
            if let Some(hotkeys) = hotkeys.as_object_mut() {
                hotkeys.entry("toggleContainers".to_string()).or_insert(json!("Ctrl+Shift+D"));
                hotkeys.entry("settings".to_string()).or_insert(json!("Ctrl+Shift+Comma"));
            }
        }
        // Icon data URIs make every cross-window update expensive. Icons are now loaded lazily from the cache.
        visit_all_shortcuts(&mut value, &mut |item| { item.insert("icon".to_string(), Value::Null); });
        migrated = true;
    }
    Ok((value, migrated))
}

fn clear_legacy_shortcut_icons(data: &mut AppData) -> bool {
    let mut changed = false;
    let mut clear = |shortcut: &mut crate::models::ShortcutItem| {
        if shortcut.icon.take().is_some() {
            changed = true;
        }
    };
    for container in &mut data.containers {
        for shortcut in &mut container.shortcuts {
            clear(shortcut);
        }
    }
    for entry in &mut data.trash {
        match entry {
            TrashEntry::Shortcut { item, .. } => clear(item),
            TrashEntry::Container { item, .. } => {
                for shortcut in &mut item.shortcuts {
                    clear(shortcut);
                }
            }
        }
    }
    for entry in &mut data.external_launcher_entries {
        if entry.icon.take().is_some() { changed = true; }
    }
    changed
}

pub fn parse_and_migrate(raw: &str) -> Result<(AppData, bool), AppError> {
    let value: Value = serde_json::from_str(raw)?;
    let (value, migrated) = migrate_value(value)?;
    let mut data: AppData = serde_json::from_value(value)?;
    data.version = CURRENT_DATA_VERSION;
    sanitize_appearance(&mut data.settings.appearance);
    let cleared_icons = clear_legacy_shortcut_icons(&mut data);
    Ok((data, migrated || cleared_icons))
}

pub fn load(path: &Path) -> Result<AppData, AppError> {
    if !path.exists() {
        let data = AppData::default();
        save(path, &data)?;
        return Ok(data);
    }

    let raw = fs::read_to_string(path)?;
    match parse_and_migrate(&raw) {
        Ok((data, true)) => {
            backup_file(path, "migration")?;
            save(path, &data)?;
            Ok(data)
        }
        Ok((data, false)) => Ok(data),
        Err(AppError::Message(message)) if message.contains("高于当前支持") => {
            Err(AppError::Message(message))
        }
        Err(error) => {
            let directory = path.parent().unwrap_or_else(|| Path::new("."));
            let backup = directory.join(format!("deskbox-data-corrupt-{}.json", timestamp()));
            fs::copy(path, backup)?;
            eprintln!("DeskBox 数据文件格式错误，已创建时间戳备份并恢复默认数据：{error}");
            let data = AppData::default();
            save(path, &data)?;
            Ok(data)
        }
    }
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension("tmp");
    fs::write(&temp, bytes)?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::{
            core::PCWSTR,
            Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH},
        };
        let from: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            MoveFileExW(
                PCWSTR(from.as_ptr()),
                PCWSTR(to.as_ptr()),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
            .map_err(|error| AppError::Message(error.to_string()))?;
        }
    }
    #[cfg(not(windows))]
    fs::rename(temp, path)?;
    Ok(())
}

pub fn save(path: &Path, data: &AppData) -> Result<(), AppError> {
    atomic_write(path, &serde_json::to_vec_pretty(data)?)
}

pub fn ensure_daily_backup(path: &Path) -> Result<(), AppError> {
    if !path.exists() {
        return Ok(());
    }
    let directory = path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("backups");
    fs::create_dir_all(&directory)?;
    let prefix = format!("daily-{}", Local::now().format("%Y%m%d"));
    let already_exists = fs::read_dir(&directory)?
        .flatten()
        .any(|entry| entry.file_name().to_string_lossy().starts_with(&prefix));
    if !already_exists {
        let target = directory.join(format!("{prefix}-{}.json", Local::now().format("%H%M%S")));
        fs::copy(path, target)?;
    }

    let mut daily: Vec<_> = fs::read_dir(&directory)?
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("daily-"))
        .collect();
    daily.sort_by_key(|entry| entry.file_name());
    let remove_count = daily.len().saturating_sub(7);
    for entry in daily.into_iter().take(remove_count) {
        fs::remove_file(entry.path())?;
    }
    Ok(())
}

pub fn backup_before_import(path: &Path) -> Result<(), AppError> {
    backup_file(path, "before-import").map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_v1_data() {
        let raw = r#"{"version":1,"containers":[],"settings":{"theme":"light","autoCollect":false,"deleteSource":false,"defaultContainerId":""}}"#;
        let (data, migrated) = parse_and_migrate(raw).unwrap();
        assert!(migrated);
        assert_eq!(data.version, 6);
        assert_eq!(data.revision, 0);
    }

    #[test]
    fn migrates_shortcuts_in_active_and_trash_containers() {
        let shortcut = r#"{"id":"shortcut","name":"App","path":"C:\\\\app.exe","icon":null,"createdAt":1,"launchCount":0,"lastLaunchedAt":null}"#;
        let raw = format!(
            r#"{{"version":2,"revision":4,"containers":[{{"id":"active","name":"Active","hidden":false,"pinned":false,"shortcuts":[{shortcut}]}}],"settings":{{"theme":"light","autoCollect":false,"deleteSource":false,"defaultContainerId":"active"}},"trash":[{{"kind":"shortcut","id":"trash-shortcut","deleted_at":1,"original_container_id":"active","original_index":0,"item":{shortcut}}},{{"kind":"container","id":"trash-container","deleted_at":2,"original_index":0,"item":{{"id":"deleted","name":"Deleted","hidden":false,"pinned":false,"shortcuts":[{shortcut}]}}}}]}}"#
        );

        let (data, migrated) = parse_and_migrate(&raw).unwrap();
        assert!(migrated);
        assert_eq!(data.version, 6);
        assert_eq!(
            data.containers[0].shortcuts[0].source,
            crate::models::ShortcutSource::Manual
        );
        assert_eq!(data.containers[0].shortcuts[0].arguments, None);
        assert_eq!(data.containers[0].shortcuts[0].working_directory, None);
        for entry in &data.trash {
            match entry {
                crate::models::TrashEntry::Shortcut { item, .. } => {
                    assert_eq!(item.source, crate::models::ShortcutSource::Manual);
                    assert_eq!(item.arguments, None);
                    assert_eq!(item.working_directory, None);
                }
                crate::models::TrashEntry::Container { item, .. } => {
                    assert_eq!(
                        item.shortcuts[0].source,
                        crate::models::ShortcutSource::Manual
                    );
                    assert_eq!(item.shortcuts[0].arguments, None);
                    assert_eq!(item.shortcuts[0].working_directory, None);
                }
            }
        }
    }

    #[test]
    fn version_three_migrates_launcher_fields() {
        let raw = r#"{"version":3,"revision":0,"containers":[{"id":"active","name":"Active","hidden":false,"pinned":false,"shortcuts":[{"id":"shortcut","name":"App","path":"C:\\app.exe","icon":null,"createdAt":1,"launchCount":0,"lastLaunchedAt":null}]}],"settings":{"theme":"light","autoCollect":false,"deleteSource":false,"defaultContainerId":"active"},"trash":[]}"#;
        let (data, migrated) = parse_and_migrate(raw).unwrap();
        assert!(migrated);
        let shortcut = &data.containers[0].shortcuts[0];
        assert_eq!(shortcut.source, crate::models::ShortcutSource::Manual);
        assert_eq!(shortcut.arguments, None);
        assert_eq!(shortcut.working_directory, None);
        assert_eq!(shortcut.target_type, crate::models::LaunchTargetType::Path);
        assert!(data.external_launcher_entries.is_empty());
    }

    #[test]
    fn rejects_future_data() {
        let raw = r#"{"version":99}"#;
        assert!(parse_and_migrate(raw).is_err());
    }

    #[test]
    fn migrates_v4_appearance_defaults() {
        let raw = r#"{"version":4,"revision":1,"containers":[],"settings":{"theme":"dark","autoCollect":false,"deleteSource":false,"defaultContainerId":"","hotkeys":{"mainWindow":"Ctrl+Shift+H","quickLaunch":"Alt+Space","toggleContainers":null},"everything":{"enabled":false,"executablePath":null}},"externalLauncherEntries":[],"trash":[]}"#;
        let (data, migrated) = parse_and_migrate(raw).unwrap();
        assert!(migrated);
        assert_eq!(data.version, 6);
        assert_eq!(data.settings.appearance.background.kind, "none");
        assert_eq!(data.settings.appearance.background.overlay, 34);
        assert!(!data.settings.appearance.adaptive_accent);
    }

    #[test]
    fn clears_icons_from_already_version_six_data() {
        let raw = r#"{"version":6,"revision":0,"containers":[{"id":"active","name":"Active","hidden":false,"pinned":false,"shortcuts":[{"id":"shortcut","name":"App","path":"C:\\app.exe","icon":"data:image/png;base64,old","createdAt":1}]}],"settings":{"theme":"light","autoCollect":false,"deleteSource":false,"defaultContainerId":"active"},"externalLauncherEntries":[],"trash":[]}"#;
        let (data, migrated) = parse_and_migrate(raw).unwrap();
        assert!(migrated);
        assert_eq!(data.containers[0].shortcuts[0].icon, None);
    }
}
