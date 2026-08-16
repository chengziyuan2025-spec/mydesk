import { createId } from "./defaults";
import type { AppData, AppOperation, ContainerItem } from "../types";

const clone = (data: AppData): AppData => structuredClone(data);

const uniqueContainerId = (data: AppData, base: string) => {
  if (!data.containers.some((item) => item.id === base)) return base;
  let suffix = data.revision + 1;
  while (data.containers.some((item) => item.id === `${base}-restored-${suffix}`)) suffix += 1;
  return `${base}-restored-${suffix}`;
};

export function applyOperation(current: AppData, operation: AppOperation): AppData {
  const data = clone(current);
  switch (operation.type) {
    case "addContainer":
      data.containers.push(operation.container);
      if (!data.settings.defaultContainerId) data.settings.defaultContainerId = operation.container.id;
      break;
    case "renameContainer": {
      const container = data.containers.find((item) => item.id === operation.containerId);
      if (container) container.name = operation.name.trim();
      break;
    }
    case "setContainerHidden": {
      const container = data.containers.find((item) => item.id === operation.containerId);
      if (container) container.hidden = operation.hidden;
      break;
    }
    case "deleteContainer": {
      const index = data.containers.findIndex((item) => item.id === operation.containerId);
      if (index < 0) break;
      const [item] = data.containers.splice(index, 1);
      data.trash.push({ kind: "container", id: operation.trashId, deletedAt: operation.deletedAt, originalIndex: index, item });
      if (data.settings.defaultContainerId === item.id) data.settings.defaultContainerId = data.containers[0]?.id ?? "";
      break;
    }
    case "reorderContainer": {
      const index = data.containers.findIndex((item) => item.id === operation.containerId);
      if (index < 0) break;
      const [item] = data.containers.splice(index, 1);
      const target = operation.beforeContainerId ? data.containers.findIndex((candidate) => candidate.id === operation.beforeContainerId) : -1;
      data.containers.splice(target < 0 ? data.containers.length : target, 0, item);
      break;
    }
    case "addShortcut":
      data.containers.find((item) => item.id === operation.containerId)?.shortcuts.push(operation.shortcut);
      break;
    case "updateShortcutIcon": {
      const shortcut = data.containers.flatMap((item) => item.shortcuts).find((item) => item.id === operation.shortcutId);
      if (shortcut) shortcut.icon = operation.icon;
      break;
    }
    case "deleteShortcut": {
      const container = data.containers.find((item) => item.id === operation.containerId);
      if (!container) break;
      const index = container.shortcuts.findIndex((item) => item.id === operation.shortcutId);
      if (index < 0) break;
      const [item] = container.shortcuts.splice(index, 1);
      data.trash.push({ kind: "shortcut", id: operation.trashId, deletedAt: operation.deletedAt, originalContainerId: operation.containerId, originalIndex: index, item });
      break;
    }
    case "moveShortcut": {
      let moved;
      for (const container of data.containers) {
        const index = container.shortcuts.findIndex((item) => item.id === operation.shortcutId);
        if (index >= 0) [moved] = container.shortcuts.splice(index, 1);
      }
      const target = data.containers.find((item) => item.id === operation.targetContainerId);
      if (!moved || !target) break;
      const index = operation.beforeShortcutId ? target.shortcuts.findIndex((item) => item.id === operation.beforeShortcutId) : -1;
      target.shortcuts.splice(index < 0 ? target.shortcuts.length : index, 0, moved);
      break;
    }
    case "updateSettings": data.settings = operation.settings; break;
    case "restoreTrash": {
      const index = data.trash.findIndex((item) => item.id === operation.trashId);
      if (index < 0) break;
      const [entry] = data.trash.splice(index, 1);
      if (entry.kind === "container") {
        entry.item.id = uniqueContainerId(data, entry.item.id);
        data.containers.splice(Math.min(entry.originalIndex, data.containers.length), 0, entry.item);
        if (!data.settings.defaultContainerId) data.settings.defaultContainerId = entry.item.id;
      } else {
        let container = data.containers.find((item) => item.id === entry.originalContainerId)
          ?? data.containers.find((item) => item.id === data.settings.defaultContainerId);
        if (!container) {
          container = { id: uniqueContainerId(data, "restored-container"), name: "已恢复", hidden: false, pinned: false, shortcuts: [] } satisfies ContainerItem;
          data.containers.push(container);
          data.settings.defaultContainerId = container.id;
        }
        if (container.shortcuts.some((item) => item.id === entry.item.id)) entry.item.id = createId("shortcut-restored");
        container.shortcuts.splice(Math.min(entry.originalIndex, container.shortcuts.length), 0, entry.item);
      }
      break;
    }
    case "permanentDeleteTrash": data.trash = data.trash.filter((item) => item.id !== operation.trashId); break;
    case "emptyTrash": data.trash = []; break;
  }
  data.revision += 1;
  return data;
}

export function migrateBrowserData(value: unknown): AppData {
  if (!value || typeof value !== "object") throw new Error("无效数据");
  const raw = value as Record<string, unknown>;
  if (Number(raw.version ?? 1) > 2) throw new Error("数据版本过高");
  const data = structuredClone(value) as AppData;
  data.version = 2;
  data.revision ??= 0;
  data.trash ??= [];
  for (const container of data.containers ?? []) {
    for (const shortcut of container.shortcuts ?? []) {
      shortcut.launchCount ??= 0;
      shortcut.lastLaunchedAt ??= null;
    }
  }
  return data;
}
