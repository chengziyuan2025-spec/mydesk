export type Theme = "light" | "dark";

export interface ShortcutItem {
  id: string;
  name: string;
  path: string;
  source: "drag_drop" | "manual";
  arguments: string | null;
  workingDirectory: string | null;
  icon: string | null;
  createdAt: number;
  launchCount: number;
  lastLaunchedAt: number | null;
}

export interface ContainerItem {
  id: string;
  name: string;
  hidden: boolean;
  pinned: boolean;
  shortcuts: ShortcutItem[];
}

export interface Settings {
  theme: Theme;
  autoCollect: boolean;
  deleteSource: boolean;
  defaultContainerId: string;
}

interface TrashBase {
  id: string;
  deletedAt: number;
  originalIndex: number;
}

export interface ShortcutTrashEntry extends TrashBase {
  kind: "shortcut";
  originalContainerId: string;
  item: ShortcutItem;
}

export interface ContainerTrashEntry extends TrashBase {
  kind: "container";
  item: ContainerItem;
}

export type TrashEntry = ShortcutTrashEntry | ContainerTrashEntry;

export interface AppData {
  version: 3;
  revision: number;
  containers: ContainerItem[];
  settings: Settings;
  trash: TrashEntry[];
}

export type AppOperation =
  | { type: "addContainer"; container: ContainerItem }
  | { type: "renameContainer"; containerId: string; name: string }
  | { type: "setContainerHidden"; containerId: string; hidden: boolean }
  | { type: "deleteContainer"; containerId: string; trashId: string; deletedAt: number }
  | { type: "reorderContainer"; containerId: string; beforeContainerId: string | null }
  | { type: "addShortcut"; containerId: string; shortcut: ShortcutItem }
  | { type: "updateShortcutIcon"; shortcutId: string; icon: string }
  | { type: "deleteShortcut"; containerId: string; shortcutId: string; trashId: string; deletedAt: number }
  | { type: "moveShortcut"; shortcutId: string; targetContainerId: string; beforeShortcutId: string | null }
  | { type: "updateSettings"; settings: Settings }
  | { type: "restoreTrash"; trashId: string }
  | { type: "permanentDeleteTrash"; trashId: string }
  | { type: "emptyTrash" };

export interface ToastMessage {
  id: string;
  type: "success" | "error" | "info";
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}
