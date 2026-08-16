use crate::{storage, AppError};
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

fn cache_path(app: &tauri::AppHandle, source: &str) -> Result<PathBuf, AppError> {
    let hash = Sha256::digest(source.to_lowercase().as_bytes());
    Ok(storage::icon_cache_dir(app)?.join(format!("{:x}.png", hash)))
}

fn as_data_uri(path: &Path) -> Result<String, AppError> {
    let bytes = fs::read(path)?;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

#[cfg(windows)]
pub fn extract(app: &tauri::AppHandle, source: &str) -> Result<Option<String>, AppError> {
    let cache = cache_path(app, source)?;
    if cache.exists() {
        return Ok(Some(as_data_uri(&cache)?));
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
    let output = Command::new("powershell.exe")
        .env("DESKBOX_ICON_SOURCE", source)
        .env("DESKBOX_ICON_TARGET", &cache)
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()?;

    if output.status.success() && cache.exists() {
        Ok(Some(as_data_uri(&cache)?))
    } else {
        Ok(None)
    }
}

#[cfg(not(windows))]
pub fn extract(_app: &tauri::AppHandle, _source: &str) -> Result<Option<String>, AppError> {
    Ok(None)
}
