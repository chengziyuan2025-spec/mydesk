import { createId } from "./defaults";
import { normalizeAppearanceSettings } from "./appearance";
import type { AppData, AppOperation, ContainerItem, ShortcutItem, TrashEntry } from "../types";

const bumpRevision = (data: AppData): AppData => ({ ...data, revision: data.revision + 1 });

const updateContainer = (data: AppData, id: string, update: (container: ContainerItem) => ContainerItem): AppData => {
  const index = data.containers.findIndex((item) => item.id === id);
  if (index < 0) return data;
  const containers = [...data.containers];
  containers[index] = update(containers[index]);
  return { ...data, containers };
};

const updateShortcut = (data: AppData, id: string, update: (shortcut: ShortcutItem) => ShortcutItem): AppData => {
  for (let containerIndex = 0; containerIndex < data.containers.length; containerIndex += 1) {
    const container = data.containers[containerIndex];
    const shortcutIndex = container.shortcuts.findIndex((item) => item.id === id);
    if (shortcutIndex < 0) continue;
    const shortcuts = [...container.shortcuts];
    shortcuts[shortcutIndex] = update(shortcuts[shortcutIndex]);
    const containers = [...data.containers];
    containers[containerIndex] = { ...container, shortcuts };
    return { ...data, containers };
  }
  return data;
};

const uniqueContainerId = (data: AppData, base: string) => {
  if (!data.containers.some((item) => item.id === base)) return base;
  let suffix = data.revision + 1;
  while (data.containers.some((item) => item.id === `${base}-restored-${suffix}`)) suffix += 1;
  return `${base}-restored-${suffix}`;
};

export function applyOperation(current: AppData, operation: AppOperation): AppData {
  let data = current;
  switch (operation.type) {
    case "addContainer": {
      const settings = current.settings.defaultContainerId ? current.settings : { ...current.settings, defaultContainerId: operation.container.id };
      data = { ...current, containers: [...current.containers, operation.container], settings };
      break;
    }
    case "renameContainer": data = updateContainer(current, operation.containerId, (container) => ({ ...container, name: operation.name.trim() })); break;
    case "setContainerHidden": data = updateContainer(current, operation.containerId, (container) => ({ ...container, hidden: operation.hidden })); break;
    case "setContainerPinned": data = updateContainer(current, operation.containerId, (container) => ({ ...container, pinned: operation.pinned })); break;
    case "setShortcutLauncherMeta": data = updateShortcut(current, operation.shortcutId, (shortcut) => ({ ...shortcut, aliases: operation.aliases, favorite: operation.favorite })); break;
    case "setContainerLauncherMeta": data = updateContainer(current, operation.containerId, (container) => ({ ...container, aliases: operation.aliases, favorite: operation.favorite })); break;
    case "recordContainerOpened": data = updateContainer(current, operation.containerId, (container) => ({ ...container, openCount: container.openCount + 1, lastOpenedAt: operation.openedAt })); break;
    case "upsertExternalLauncherEntry": {
      const index = current.externalLauncherEntries.findIndex((item) => item.key === operation.entry.key);
      const externalLauncherEntries = index < 0
        ? [...current.externalLauncherEntries, operation.entry]
        : current.externalLauncherEntries.map((item, itemIndex) => itemIndex === index ? operation.entry : item);
      const disposable = externalLauncherEntries
        .filter((item) => !item.favorite && item.aliases.length === 0)
        .sort((a, b) => (b.lastLaunchedAt ?? 0) - (a.lastLaunchedAt ?? 0));
      const stale = new Set(disposable.slice(100).map((item) => item.key));
      data = { ...current, externalLauncherEntries: stale.size ? externalLauncherEntries.filter((item) => !stale.has(item.key)) : externalLauncherEntries };
      break;
    }
    case "removeExternalLauncherEntry": data = { ...current, externalLauncherEntries: current.externalLauncherEntries.filter((item) => item.key !== operation.key) }; break;
    case "deleteContainer": {
      const index = current.containers.findIndex((item) => item.id === operation.containerId);
      if (index < 0) break;
      const item = current.containers[index];
      const containers = current.containers.filter((_, itemIndex) => itemIndex !== index);
      const settings = current.settings.defaultContainerId === item.id ? { ...current.settings, defaultContainerId: containers[0]?.id ?? "" } : current.settings;
      data = { ...current, containers, settings, trash: [...current.trash, { kind: "container", id: operation.trashId, deletedAt: operation.deletedAt, originalIndex: index, item }] };
      break;
    }
    case "reorderContainer": {
      const index = current.containers.findIndex((item) => item.id === operation.containerId);
      if (index < 0) break;
      const item = current.containers[index];
      const containers = current.containers.filter((_, itemIndex) => itemIndex !== index);
      const target = operation.beforeContainerId ? containers.findIndex((candidate) => candidate.id === operation.beforeContainerId) : -1;
      containers.splice(target < 0 ? containers.length : target, 0, item);
      data = { ...current, containers };
      break;
    }
    case "addShortcut":
      data = updateContainer(current, operation.containerId, (container) => ({ ...container, shortcuts: [...container.shortcuts, operation.shortcut] }));
      break;
    case "deleteShortcut": {
      const container = current.containers.find((item) => item.id === operation.containerId);
      if (!container) break;
      const index = container.shortcuts.findIndex((item) => item.id === operation.shortcutId);
      if (index < 0) break;
      const item = container.shortcuts[index];
      data = updateContainer(current, operation.containerId, (value) => ({ ...value, shortcuts: value.shortcuts.filter((_, itemIndex) => itemIndex !== index) }));
      data = { ...data, trash: [...current.trash, { kind: "shortcut", id: operation.trashId, deletedAt: operation.deletedAt, originalContainerId: operation.containerId, originalIndex: index, item }] };
      break;
    }
    case "moveShortcut": {
      const source = current.containers.find((container) => container.shortcuts.some((item) => item.id === operation.shortcutId));
      const target = current.containers.find((container) => container.id === operation.targetContainerId);
      if (!source || !target) break;
      const moved = source.shortcuts.find((item) => item.id === operation.shortcutId)!;
      const targetShortcuts = source.id === target.id ? source.shortcuts.filter((item) => item.id !== moved.id) : [...target.shortcuts];
      const index = operation.beforeShortcutId ? targetShortcuts.findIndex((item) => item.id === operation.beforeShortcutId) : -1;
      targetShortcuts.splice(index < 0 ? targetShortcuts.length : index, 0, moved);
      data = {
        ...current,
        containers: current.containers.map((container) => {
          if (container.id === target.id) return { ...container, shortcuts: targetShortcuts };
          if (container.id === source.id) return { ...container, shortcuts: container.shortcuts.filter((item) => item.id !== moved.id) };
          return container;
        }),
      };
      break;
    }
    case "updateSettings": data = { ...current, settings: operation.settings }; break;
    case "restoreTrash": {
      const index = current.trash.findIndex((item) => item.id === operation.trashId);
      if (index < 0) break;
      const entry = current.trash[index];
      const trash = current.trash.filter((_, itemIndex) => itemIndex !== index);
      if (entry.kind === "container") {
        const id = uniqueContainerId(current, entry.item.id);
        const item = id === entry.item.id ? entry.item : { ...entry.item, id };
        const containers = [...current.containers];
        containers.splice(Math.min(entry.originalIndex, containers.length), 0, item);
        const settings = current.settings.defaultContainerId ? current.settings : { ...current.settings, defaultContainerId: item.id };
        data = { ...current, containers, settings, trash };
      } else {
        let targetIndex = current.containers.findIndex((item) => item.id === entry.originalContainerId);
        if (targetIndex < 0) targetIndex = current.containers.findIndex((item) => item.id === current.settings.defaultContainerId);
        let containers = current.containers;
        let settings = current.settings;
        if (targetIndex < 0) {
          const fallback: ContainerItem = { id: uniqueContainerId(current, "restored-container"), name: "已恢复", hidden: false, pinned: false, aliases: [], favorite: false, openCount: 0, lastOpenedAt: null, hotkey: null, shortcuts: [] };
          containers = [...current.containers, fallback];
          targetIndex = containers.length - 1;
          settings = { ...current.settings, defaultContainerId: fallback.id };
        }
        const target = containers[targetIndex];
        const item = target.shortcuts.some((shortcut) => shortcut.id === entry.item.id) ? { ...entry.item, id: createId("shortcut-restored") } : entry.item;
        const shortcuts = [...target.shortcuts];
        shortcuts.splice(Math.min(entry.originalIndex, shortcuts.length), 0, item);
        containers = [...containers];
        containers[targetIndex] = { ...target, shortcuts };
        data = { ...current, containers, settings, trash };
      }
      break;
    }
    case "permanentDeleteTrash": data = { ...current, trash: current.trash.filter((item) => item.id !== operation.trashId) }; break;
    case "emptyTrash": data = { ...current, trash: [] }; break;
  }
  return bumpRevision(data);
}

export function migrateBrowserData(value: unknown): AppData {
  if (!value || typeof value !== "object") throw new Error("无效数据");
  const raw = value as Record<string, unknown>;
  if (Number(raw.version ?? 1) > 6) throw new Error("数据版本过高");
  const data = structuredClone(value) as AppData;
  data.version = 6;
  data.revision ??= 0;
  data.trash ??= [];
  data.externalLauncherEntries ??= [];
  data.settings.hotkeys ??= { mainWindow: "Ctrl+Shift+H", quickLaunch: "Alt+Space", toggleContainers: "Ctrl+Shift+D", settings: "Ctrl+Shift+Comma" };
  data.settings.hotkeys.toggleContainers ??= "Ctrl+Shift+D";
  data.settings.hotkeys.settings ??= "Ctrl+Shift+Comma";
  data.settings.everything ??= { enabled: false, executablePath: null };
  data.settings.appearance = normalizeAppearanceSettings(data.settings.appearance);

  const migrateShortcut = (shortcut: ShortcutItem) => {
    shortcut.source ??= "manual";
    shortcut.targetType ??= /^https?:\/\//i.test(shortcut.path) ? "url" : "path";
    shortcut.aliases ??= [];
    shortcut.favorite ??= false;
    shortcut.arguments ??= null;
    shortcut.workingDirectory ??= null;
    shortcut.sourcePath ??= null;
    // v6 no longer persists Base64 icon payloads with application data.
    shortcut.icon = null;
    shortcut.createdAt ??= 0;
    shortcut.launchCount ??= 0;
    shortcut.lastLaunchedAt ??= null;
  };
  for (const container of data.containers ?? []) {
    container.aliases ??= [];
    container.favorite ??= false;
    container.openCount ??= 0;
    container.lastOpenedAt ??= null;
    container.hotkey ??= null;
    for (const shortcut of container.shortcuts ?? []) migrateShortcut(shortcut);
  }
  for (const entry of data.trash as TrashEntry[]) {
    if (entry.kind === "shortcut") migrateShortcut(entry.item);
    else {
      entry.item.aliases ??= [];
      entry.item.favorite ??= false;
      entry.item.openCount ??= 0;
      entry.item.lastOpenedAt ??= null;
      entry.item.hotkey ??= null;
      for (const shortcut of entry.item.shortcuts ?? []) migrateShortcut(shortcut);
    }
  }
  for (const entry of data.externalLauncherEntries) entry.icon = null;
  return data;
}
