export type Theme = "light" | "dark";
export type LaunchTargetType = "path" | "url" | "shellApp";
export type BackgroundKind = "none" | "image" | "video";

export interface BackgroundSettings {
  kind: BackgroundKind;
  assetPath: string | null;
  assetName: string | null;
  overlay: number;
}

export interface AppearanceSettings {
  accentColor: string | null;
  adaptiveAccent: boolean;
  background: BackgroundSettings;
}

export interface ShortcutItem {
  id: string;
  name: string;
  path: string;
  targetType: LaunchTargetType;
  aliases: string[];
  favorite: boolean;
  sourcePath?: string | null;
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
  aliases: string[];
  favorite: boolean;
  openCount: number;
  lastOpenedAt: number | null;
  hotkey: string | null;
  shortcuts: ShortcutItem[];
}

export type FloatingLayout = "compact" | "grid" | "list";
export type SnapEdge = "none" | "left" | "right" | "top" | "bottom";
export type DockSide = "left" | "right";

export interface MonitorInfo {
  key: string;
  name: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContainerWindowSettings {
  monitorKey: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  expandedHeight?: number;
  collapsed: boolean;
  locked: boolean;
  opacity: number;
  clickThrough: boolean;
  snapEdge: SnapEdge;
  autoHide: boolean;
  docked: boolean;
  dockSide: DockSide | null;
  layout: FloatingLayout;
  skipTaskbar: boolean;
  allWorkspaces: boolean;
}

export interface Settings {
  theme: Theme;
  appearance: AppearanceSettings;
  autoCollect: boolean;
  deleteSource: boolean;
  defaultContainerId: string;
  hotkeys: {
    mainWindow: string | null;
    quickLaunch: string | null;
    toggleContainers: string | null;
    settings: string | null;
  };
  everything: {
    enabled: boolean;
    executablePath: string | null;
  };
}

export interface ExternalLauncherEntry {
  key: string;
  kind: "systemApp" | "file" | "folder";
  name: string;
  targetType: LaunchTargetType;
  target: string;
  sourcePath: string | null;
  icon: string | null;
  aliases: string[];
  favorite: boolean;
  launchCount: number;
  lastLaunchedAt: number | null;
}

export interface SystemAppCatalogItem {
  key: string;
  name: string;
  targetType: LaunchTargetType;
  target: string;
  sourcePath: string | null;
  icon: string | null;
}

export interface EverythingSearchItem {
  key: string;
  name: string;
  path: string;
  isDirectory: boolean;
}

export type HotkeyAction = "mainWindow" | "quickLaunch" | "toggleContainers" | "settings" | `container:${string}`;
export interface HotkeyStatus {
  action: HotkeyAction;
  accelerator: string | null;
  state: "active" | "unassigned" | "conflict" | "invalid";
  message: string | null;
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
  version: 6;
  revision: number;
  containers: ContainerItem[];
  settings: Settings;
  externalLauncherEntries: ExternalLauncherEntry[];
  trash: TrashEntry[];
}

export interface BackgroundMediaSelection {
  kind: Exclude<BackgroundKind, "none">;
  assetPath: string;
  assetName: string;
}

export type AppOperation =
  | { type: "addContainer"; container: ContainerItem }
  | { type: "renameContainer"; containerId: string; name: string }
  | { type: "setContainerHidden"; containerId: string; hidden: boolean }
  | { type: "setContainerPinned"; containerId: string; pinned: boolean }
  | { type: "deleteContainer"; containerId: string; trashId: string; deletedAt: number }
  | { type: "reorderContainer"; containerId: string; beforeContainerId: string | null }
  | { type: "addShortcut"; containerId: string; shortcut: ShortcutItem }
  | { type: "setShortcutLauncherMeta"; shortcutId: string; aliases: string[]; favorite: boolean }
  | { type: "setContainerLauncherMeta"; containerId: string; aliases: string[]; favorite: boolean }
  | { type: "recordContainerOpened"; containerId: string; openedAt: number }
  | { type: "upsertExternalLauncherEntry"; entry: ExternalLauncherEntry }
  | { type: "removeExternalLauncherEntry"; key: string }
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
