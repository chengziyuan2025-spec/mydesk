use crate::{
    models::{AppData, AppOperation, ContainerItem, TrashEntry},
    AppError,
};

fn unique_container_id(data: &AppData, base: &str) -> String {
    if !data.containers.iter().any(|item| item.id == base) {
        return base.to_string();
    }
    let mut suffix = data.revision + 1;
    loop {
        let candidate = format!("{base}-restored-{suffix}");
        if !data.containers.iter().any(|item| item.id == candidate) {
            return candidate;
        }
        suffix += 1;
    }
}

fn unique_shortcut_ids(container: &mut ContainerItem, revision: u64) {
    let mut seen = std::collections::HashSet::new();
    for (index, shortcut) in container.shortcuts.iter_mut().enumerate() {
        if !seen.insert(shortcut.id.clone()) {
            shortcut.id = format!("{}-restored-{}-{index}", shortcut.id, revision + 1);
            seen.insert(shortcut.id.clone());
        }
    }
}

pub fn apply(data: &mut AppData, operation: AppOperation) -> Result<(), AppError> {
    match operation {
        AppOperation::AddContainer { container } => {
            if data.containers.iter().any(|item| item.id == container.id) {
                return Err(AppError::Message("容器 ID 已存在".to_string()));
            }
            data.containers.push(container);
        }
        AppOperation::RenameContainer { container_id, name } => {
            let name = name.trim();
            if name.is_empty() {
                return Err(AppError::Message("容器名称不能为空".to_string()));
            }
            let container = data
                .containers
                .iter_mut()
                .find(|item| item.id == container_id)
                .ok_or_else(|| AppError::Message("容器不存在".to_string()))?;
            container.name = name.to_string();
        }
        AppOperation::SetContainerHidden {
            container_id,
            hidden,
        } => {
            let container = data
                .containers
                .iter_mut()
                .find(|item| item.id == container_id)
                .ok_or_else(|| AppError::Message("容器不存在".to_string()))?;
            container.hidden = hidden;
        }
        AppOperation::SetContainerPinned {
            container_id,
            pinned,
        } => {
            let container = data
                .containers
                .iter_mut()
                .find(|item| item.id == container_id)
                .ok_or_else(|| AppError::Message("容器不存在".to_string()))?;
            container.pinned = pinned;
        }
        AppOperation::SetShortcutLauncherMeta { shortcut_id, aliases, favorite } => {
            let shortcut = data.containers.iter_mut().flat_map(|item| &mut item.shortcuts)
                .find(|item| item.id == shortcut_id)
                .ok_or_else(|| AppError::Message("快捷方式不存在".to_string()))?;
            shortcut.aliases = aliases;
            shortcut.favorite = favorite;
        }
        AppOperation::SetContainerLauncherMeta { container_id, aliases, favorite } => {
            let container = data.containers.iter_mut().find(|item| item.id == container_id)
                .ok_or_else(|| AppError::Message("容器不存在".to_string()))?;
            container.aliases = aliases;
            container.favorite = favorite;
        }
        AppOperation::RecordContainerOpened { container_id, opened_at } => {
            let container = data.containers.iter_mut().find(|item| item.id == container_id)
                .ok_or_else(|| AppError::Message("容器不存在".to_string()))?;
            container.open_count = container.open_count.saturating_add(1);
            container.last_opened_at = Some(opened_at);
        }
        AppOperation::UpsertExternalLauncherEntry { entry } => {
            if let Some(existing) = data.external_launcher_entries.iter_mut().find(|item| item.key == entry.key) { *existing = entry; }
            else { data.external_launcher_entries.push(entry); }
            let mut disposable: Vec<_> = data.external_launcher_entries.iter()
                .filter(|item| !item.favorite && item.aliases.is_empty())
                .map(|item| (item.key.clone(), item.last_launched_at.unwrap_or(0)))
                .collect();
            disposable.sort_by_key(|item| std::cmp::Reverse(item.1));
            let stale: std::collections::HashSet<_> = disposable.into_iter().skip(100).map(|item| item.0).collect();
            data.external_launcher_entries.retain(|item| !stale.contains(&item.key));
        }
        AppOperation::RemoveExternalLauncherEntry { key } => {
            data.external_launcher_entries.retain(|item| item.key != key);
        }
        AppOperation::DeleteContainer {
            container_id,
            trash_id,
            deleted_at,
        } => {
            let index = data
                .containers
                .iter()
                .position(|item| item.id == container_id)
                .ok_or_else(|| AppError::Message("容器不存在".to_string()))?;
            let item = data.containers.remove(index);
            data.trash.push(TrashEntry::Container {
                id: trash_id,
                deleted_at,
                original_index: index,
                item,
            });
            if data.settings.default_container_id == container_id {
                data.settings.default_container_id = data
                    .containers
                    .first()
                    .map(|item| item.id.clone())
                    .unwrap_or_default();
            }
        }
        AppOperation::ReorderContainer {
            container_id,
            before_container_id,
        } => {
            let source = data
                .containers
                .iter()
                .position(|item| item.id == container_id)
                .ok_or_else(|| AppError::Message("容器不存在".to_string()))?;
            let item = data.containers.remove(source);
            let target = before_container_id
                .and_then(|id| {
                    data.containers
                        .iter()
                        .position(|candidate| candidate.id == id)
                })
                .unwrap_or(data.containers.len());
            data.containers.insert(target, item);
        }
        AppOperation::AddShortcut {
            container_id,
            shortcut,
        } => {
            if data
                .containers
                .iter()
                .flat_map(|item| &item.shortcuts)
                .any(|item| item.id == shortcut.id)
            {
                return Err(AppError::Message("快捷方式 ID 已存在".to_string()));
            }
            let container = data
                .containers
                .iter_mut()
                .find(|item| item.id == container_id)
                .ok_or_else(|| AppError::Message("容器不存在".to_string()))?;
            container.shortcuts.push(shortcut);
        }
        AppOperation::UpdateShortcutIcon { shortcut_id, icon } => {
            let shortcut = data
                .containers
                .iter_mut()
                .flat_map(|item| &mut item.shortcuts)
                .find(|item| item.id == shortcut_id)
                .ok_or_else(|| AppError::Message("快捷方式不存在".to_string()))?;
            shortcut.icon = Some(icon);
        }
        AppOperation::DeleteShortcut {
            container_id,
            shortcut_id,
            trash_id,
            deleted_at,
        } => {
            let container = data
                .containers
                .iter_mut()
                .find(|item| item.id == container_id)
                .ok_or_else(|| AppError::Message("容器不存在".to_string()))?;
            let index = container
                .shortcuts
                .iter()
                .position(|item| item.id == shortcut_id)
                .ok_or_else(|| AppError::Message("快捷方式不存在".to_string()))?;
            let item = container.shortcuts.remove(index);
            data.trash.push(TrashEntry::Shortcut {
                id: trash_id,
                deleted_at,
                original_container_id: container_id,
                original_index: index,
                item,
            });
        }
        AppOperation::MoveShortcut {
            shortcut_id,
            target_container_id,
            before_shortcut_id,
        } => {
            let mut moved = None;
            for container in &mut data.containers {
                if let Some(index) = container
                    .shortcuts
                    .iter()
                    .position(|item| item.id == shortcut_id)
                {
                    moved = Some(container.shortcuts.remove(index));
                    break;
                }
            }
            let moved = moved.ok_or_else(|| AppError::Message("快捷方式不存在".to_string()))?;
            let target = data
                .containers
                .iter_mut()
                .find(|item| item.id == target_container_id)
                .ok_or_else(|| AppError::Message("目标容器不存在".to_string()))?;
            let index = before_shortcut_id
                .and_then(|id| target.shortcuts.iter().position(|item| item.id == id))
                .unwrap_or(target.shortcuts.len());
            target.shortcuts.insert(index, moved);
        }
        AppOperation::UpdateSettings { settings } => data.settings = settings,
        AppOperation::RestoreTrash { trash_id } => {
            let index = data
                .trash
                .iter()
                .position(|item| item.id() == trash_id)
                .ok_or_else(|| AppError::Message("回收站项目不存在".to_string()))?;
            match data.trash.remove(index) {
                TrashEntry::Container {
                    original_index,
                    mut item,
                    ..
                } => {
                    item.id = unique_container_id(data, &item.id);
                    unique_shortcut_ids(&mut item, data.revision);
                    let target = original_index.min(data.containers.len());
                    if data.settings.default_container_id.is_empty() {
                        data.settings.default_container_id = item.id.clone();
                    }
                    data.containers.insert(target, item);
                }
                TrashEntry::Shortcut {
                    original_container_id,
                    original_index,
                    item,
                    ..
                } => {
                    let target_index =
                        if let Some(index) = data
                            .containers
                            .iter()
                            .position(|container| container.id == original_container_id)
                        {
                            index
                        } else if let Some(index) = data.containers.iter().position(|container| {
                            container.id == data.settings.default_container_id
                        }) {
                            index
                        } else {
                            let id = unique_container_id(data, "restored-container");
                            data.containers.push(ContainerItem {
                                id: id.clone(),
                                name: "已恢复".to_string(),
                                hidden: false,
                                pinned: false,
                                aliases: Vec::new(),
                                favorite: false,
                                open_count: 0,
                                last_opened_at: None,
                                hotkey: None,
                                shortcuts: Vec::new(),
                            });
                            data.settings.default_container_id = id;
                            data.containers.len() - 1
                        };
                    let container = &mut data.containers[target_index];
                    let target = original_index.min(container.shortcuts.len());
                    container.shortcuts.insert(target, item);
                }
            }
        }
        AppOperation::PermanentDeleteTrash { trash_id } => {
            let original_len = data.trash.len();
            data.trash.retain(|item| item.id() != trash_id);
            if data.trash.len() == original_len {
                return Err(AppError::Message("回收站项目不存在".to_string()));
            }
        }
        AppOperation::EmptyTrash => data.trash.clear(),
    }
    data.revision = data.revision.saturating_add(1);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deletes_and_restores_shortcut() {
        let mut data = AppData::default();
        let shortcut_id = data.containers[0].shortcuts[0].id.clone();
        apply(
            &mut data,
            AppOperation::DeleteShortcut {
                container_id: "sample-container".into(),
                shortcut_id,
                trash_id: "trash-1".into(),
                deleted_at: 1,
            },
        )
        .unwrap();
        assert_eq!(data.trash.len(), 1);
        apply(
            &mut data,
            AppOperation::RestoreTrash {
                trash_id: "trash-1".into(),
            },
        )
        .unwrap();
        assert_eq!(data.containers[0].shortcuts.len(), 2);
        assert!(data.trash.is_empty());
    }

    #[test]
    fn moves_shortcut_by_anchor() {
        let mut data = AppData::default();
        let first = data.containers[0].shortcuts[0].id.clone();
        let second = data.containers[0].shortcuts[1].id.clone();
        apply(
            &mut data,
            AppOperation::MoveShortcut {
                shortcut_id: second.clone(),
                target_container_id: "sample-container".into(),
                before_shortcut_id: Some(first),
            },
        )
        .unwrap();
        assert_eq!(data.containers[0].shortcuts[0].id, second);
    }
}
