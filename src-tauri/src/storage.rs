use crate::{models::{AppData, CURRENT_DATA_VERSION}, AppError};
use chrono::Local;
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub fn data_path(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|error| AppError::Message(error.to_string()))?;
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
    let dir = app.path().app_cache_dir().map_err(|error| AppError::Message(error.to_string()))?.join("icons");
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
    let directory = path.parent().unwrap_or_else(|| Path::new(".")).join("backups");
    fs::create_dir_all(&directory)?;
    let target = directory.join(format!("{label}-{}.json", timestamp()));
    fs::copy(path, &target)?;
    Ok(Some(target))
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
        let object = value.as_object_mut().ok_or_else(|| AppError::Message("数据根节点必须是对象".to_string()))?;
        object.insert("version".to_string(), json!(2));
        object.entry("revision".to_string()).or_insert(json!(0));
        object.entry("trash".to_string()).or_insert(json!([]));
        if let Some(containers) = object.get_mut("containers").and_then(Value::as_array_mut) {
            for container in containers {
                if let Some(shortcuts) = container.get_mut("shortcuts").and_then(Value::as_array_mut) {
                    for shortcut in shortcuts {
                        if let Some(item) = shortcut.as_object_mut() {
                            item.entry("launchCount".to_string()).or_insert(json!(0));
                            item.entry("lastLaunchedAt".to_string()).or_insert(Value::Null);
                        }
                    }
                }
            }
        }
        migrated = true;
    }
    Ok((value, migrated))
}

pub fn parse_and_migrate(raw: &str) -> Result<(AppData, bool), AppError> {
    let value: Value = serde_json::from_str(raw)?;
    let (value, migrated) = migrate_value(value)?;
    let mut data: AppData = serde_json::from_value(value)?;
    data.version = CURRENT_DATA_VERSION;
    Ok((data, migrated))
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
        Err(AppError::Message(message)) if message.contains("高于当前支持") => Err(AppError::Message(message)),
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

pub fn save(path: &Path, data: &AppData) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension("tmp");
    fs::write(&temp, serde_json::to_vec_pretty(data)?)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(temp, path)?;
    Ok(())
}

pub fn ensure_daily_backup(path: &Path) -> Result<(), AppError> {
    if !path.exists() {
        return Ok(());
    }
    let directory = path.parent().unwrap_or_else(|| Path::new(".")).join("backups");
    fs::create_dir_all(&directory)?;
    let prefix = format!("daily-{}", Local::now().format("%Y%m%d"));
    let already_exists = fs::read_dir(&directory)?.flatten().any(|entry| {
        entry.file_name().to_string_lossy().starts_with(&prefix)
    });
    if !already_exists {
        let target = directory.join(format!("{prefix}-{}.json", Local::now().format("%H%M%S")));
        fs::copy(path, target)?;
    }

    let mut daily: Vec<_> = fs::read_dir(&directory)?.flatten()
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
        assert_eq!(data.version, 2);
        assert_eq!(data.revision, 0);
    }

    #[test]
    fn rejects_future_data() {
        let raw = r#"{"version":99}"#;
        assert!(parse_and_migrate(raw).is_err());
    }
}
