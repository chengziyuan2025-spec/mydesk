use serde::{Deserialize, Serialize};

pub const CURRENT_DATA_VERSION: u32 = 3;

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
    pub shortcuts: Vec<ShortcutItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub auto_collect: bool,
    pub delete_source: bool,
    pub default_container_id: String,
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
    UpdateShortcutIcon {
        shortcut_id: String,
        icon: String,
    },
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
                shortcuts: vec![
                    ShortcutItem {
                        id: "sample-calculator".to_string(),
                        name: "计算器".to_string(),
                        path: format!("{}\\calc.exe", system32),
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
                auto_collect: true,
                delete_source: false,
                default_container_id: container_id,
            },
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
}
