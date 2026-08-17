use serde::{Deserialize, Serialize};

pub const CURRENT_DATA_VERSION: u32 = 6;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum LaunchTargetType {
    #[default]
    Path,
    Url,
    ShellApp,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ShortcutSource {
    #[default]
    Manual,
    DragDrop,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutItem {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub target_type: LaunchTargetType,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    pub created_at: u64,
    #[serde(default)]
    pub source: ShortcutSource,
    #[serde(default)]
    pub arguments: Option<String>,
    #[serde(default)]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub launch_count: u64,
    #[serde(default)]
    pub last_launched_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutInfo {
    pub name: String,
    pub target_path: String,
    pub arguments: Option<String>,
    pub working_directory: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContainerItem {
    pub id: String,
    pub name: String,
    pub hidden: bool,
    pub pinned: bool,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub open_count: u64,
    #[serde(default)]
    pub last_opened_at: Option<u64>,
    #[serde(default)]
    pub hotkey: Option<String>,
    pub shortcuts: Vec<ShortcutItem>,
}

fn default_main_hotkey() -> Option<String> { Some("Ctrl+Shift+H".to_string()) }
fn default_quick_hotkey() -> Option<String> { Some("Alt+Space".to_string()) }
fn default_toggle_hotkey() -> Option<String> { Some("Ctrl+Shift+D".to_string()) }
fn default_settings_hotkey() -> Option<String> { Some("Ctrl+Shift+Comma".to_string()) }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GlobalHotkeys {
    #[serde(default = "default_main_hotkey")]
    pub main_window: Option<String>,
    #[serde(default = "default_quick_hotkey")]
    pub quick_launch: Option<String>,
    #[serde(default = "default_toggle_hotkey")]
    pub toggle_containers: Option<String>,
    #[serde(default = "default_settings_hotkey")]
    pub settings: Option<String>,
}

impl Default for GlobalHotkeys {
    fn default() -> Self { Self { main_window: default_main_hotkey(), quick_launch: default_quick_hotkey(), toggle_containers: default_toggle_hotkey(), settings: default_settings_hotkey() } }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EverythingSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub executable_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundSettings {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub asset_path: Option<String>,
    #[serde(default)]
    pub asset_name: Option<String>,
    #[serde(default = "default_background_overlay")]
    pub overlay: u8,
}

fn default_background_overlay() -> u8 { 34 }

impl Default for BackgroundSettings {
    fn default() -> Self { Self { kind: "none".into(), asset_path: None, asset_name: None, overlay: default_background_overlay() } }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    #[serde(default)]
    pub accent_color: Option<String>,
    #[serde(default)]
    pub adaptive_accent: bool,
    #[serde(default)]
    pub background: BackgroundSettings,
}

pub fn sanitize_appearance(settings: &mut AppearanceSettings) {
    settings.accent_color = settings.accent_color.as_ref().and_then(|value| {
        let valid = value.len() == 7
            && value.starts_with('#')
            && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit);
        valid.then(|| value.to_ascii_lowercase())
    });
    if !matches!(settings.background.kind.as_str(), "image" | "video") {
        settings.background.kind = "none".into();
        settings.background.asset_path = None;
        settings.background.asset_name = None;
    }
    settings.background.overlay = settings.background.overlay.min(80);
    if settings.background.asset_path.as_deref().map(str::trim).filter(|value| !value.is_empty()).is_none() {
        settings.background.kind = "none".into();
        settings.background.asset_path = None;
        settings.background.asset_name = None;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    #[serde(default)]
    pub appearance: AppearanceSettings,
    pub auto_collect: bool,
    pub delete_source: bool,
    pub default_container_id: String,
    #[serde(default)]
    pub hotkeys: GlobalHotkeys,
    #[serde(default)]
    pub everything: EverythingSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLauncherEntry {
    pub key: String,
    pub kind: String,
    pub name: String,
    pub target_type: LaunchTargetType,
    pub target: String,
    pub source_path: Option<String>,
    pub icon: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub launch_count: u64,
    #[serde(default)]
    pub last_launched_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TrashEntry {
    Shortcut {
        id: String,
        deleted_at: u64,
        original_container_id: String,
        original_index: usize,
        item: ShortcutItem,
    },
    Container {
        id: String,
        deleted_at: u64,
        original_index: usize,
        item: ContainerItem,
    },
}

impl TrashEntry {
    pub fn id(&self) -> &str {
        match self {
            Self::Shortcut { id, .. } | Self::Container { id, .. } => id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    pub version: u32,
    #[serde(default)]
    pub revision: u64,
    pub containers: Vec<ContainerItem>,
    pub settings: Settings,
    #[serde(default)]
    pub external_launcher_entries: Vec<ExternalLauncherEntry>,
    #[serde(default)]
    pub trash: Vec<TrashEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AppOperation {
    AddContainer {
        container: ContainerItem,
    },
    RenameContainer {
        container_id: String,
        name: String,
    },
    SetContainerHidden {
        container_id: String,
        hidden: bool,
    },
    SetContainerPinned {
        container_id: String,
        pinned: bool,
    },
    DeleteContainer {
        container_id: String,
        trash_id: String,
        deleted_at: u64,
    },
    ReorderContainer {
        container_id: String,
        before_container_id: Option<String>,
    },
    AddShortcut {
        container_id: String,
        shortcut: ShortcutItem,
    },
    SetShortcutLauncherMeta { shortcut_id: String, aliases: Vec<String>, favorite: bool },
    SetContainerLauncherMeta { container_id: String, aliases: Vec<String>, favorite: bool },
    RecordContainerOpened { container_id: String, opened_at: u64 },
    UpsertExternalLauncherEntry { entry: ExternalLauncherEntry },
    RemoveExternalLauncherEntry { key: String },
    DeleteShortcut {
        container_id: String,
        shortcut_id: String,
        trash_id: String,
        deleted_at: u64,
    },
    MoveShortcut {
        shortcut_id: String,
        target_container_id: String,
        before_shortcut_id: Option<String>,
    },
    UpdateSettings {
        settings: Settings,
    },
    RestoreTrash {
        trash_id: String,
    },
    PermanentDeleteTrash {
        trash_id: String,
    },
    EmptyTrash,
}

impl Default for AppData {
    fn default() -> Self {
        let container_id = "sample-container".to_string();
        let system_root = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_string());
        let system32 = format!("{}\\System32", system_root);

        Self {
            version: CURRENT_DATA_VERSION,
            revision: 0,
            containers: vec![ContainerItem {
                id: container_id.clone(),
                name: "示例".to_string(),
                hidden: false,
                pinned: false,
                aliases: Vec::new(),
                favorite: false,
                open_count: 0,
                last_opened_at: None,
                hotkey: None,
                shortcuts: vec![
                    ShortcutItem {
                        id: "sample-calculator".to_string(),
                        name: "计算器".to_string(),
                        path: format!("{}\\calc.exe", system32),
                        target_type: LaunchTargetType::Path,
                        aliases: Vec::new(),
                        favorite: false,
                        source_path: None,
                        icon: None,
                        created_at: 0,
                        source: ShortcutSource::Manual,
                        arguments: None,
                        working_directory: None,
                        launch_count: 0,
                        last_launched_at: None,
                    },
                    ShortcutItem {
                        id: "sample-notepad".to_string(),
                        name: "记事本".to_string(),
                        path: format!("{}\\notepad.exe", system32),
                        target_type: LaunchTargetType::Path,
                        aliases: Vec::new(),
                        favorite: false,
                        source_path: None,
                        icon: None,
                        created_at: 0,
                        source: ShortcutSource::Manual,
                        arguments: None,
                        working_directory: None,
                        launch_count: 0,
                        last_launched_at: None,
                    },
                ],
            }],
            settings: Settings {
                theme: "light".to_string(),
                appearance: AppearanceSettings::default(),
                auto_collect: true,
                delete_source: false,
                default_container_id: container_id,
                hotkeys: GlobalHotkeys::default(),
                everything: EverythingSettings::default(),
            },
            external_launcher_entries: Vec::new(),
            trash: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortcut_source_uses_persisted_wire_values() {
        assert_eq!(
            serde_json::to_string(&ShortcutSource::Manual).unwrap(),
            "\"manual\""
        );
        assert_eq!(
            serde_json::to_string(&ShortcutSource::DragDrop).unwrap(),
            "\"drag_drop\""
        );
    }

    #[test]
    fn sanitizes_invalid_appearance_values() {
        let mut appearance = AppearanceSettings { accent_color: Some("blue".into()), adaptive_accent: false, background: BackgroundSettings { kind: "unknown".into(), asset_path: None, asset_name: Some("old.png".into()), overlay: 100 } };
        sanitize_appearance(&mut appearance);
        assert_eq!(appearance.accent_color, None);
        assert_eq!(appearance.background.kind, "none");
        assert_eq!(appearance.background.asset_name, None);
        assert_eq!(appearance.background.overlay, 80);
    }
}
