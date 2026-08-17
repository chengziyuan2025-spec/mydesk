import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppData, AppOperation, BackgroundMediaSelection, ContainerWindowSettings, EverythingSearchItem, HotkeyAction, HotkeyStatus, LaunchTargetType, MonitorInfo, SystemAppCatalogItem } from "../types";
import { createDefaultData } from "../data/defaults";
import { applyOperation, migrateBrowserData } from "../data/operations";
import { backgroundKindFromFileName } from "../data/appearance";

const STORAGE_KEY = "deskbox-browser-data";
const isTauri = () => "__TAURI_INTERNALS__" in window;

const browserLoad = (): AppData => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return createDefaultData();
  try { return migrateBrowserData(JSON.parse(stored)); }
  catch { return createDefaultData(); }
};

const browserSave = (data: AppData) => localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

export interface ShortcutInfo {
  name: string;
  targetPath: string;
  arguments: string | null;
  workingDirectory: string | null;
}

export interface EverythingDetection { installed: boolean; running: boolean; executablePath: string | null; message: string }
export interface OperationCommit { revision: number }
export interface AppDataChange { revision: number; operation: AppOperation | null }

export const platform = {
  isDesktop: isTauri,
  async loadData(): Promise<AppData> { return isTauri() ? invoke<AppData>("load_app_data") : browserLoad(); },
  async applyOperation(operation: AppOperation): Promise<OperationCommit> {
    if (isTauri()) return invoke<OperationCommit>("apply_app_operation", { operation });
    const data = applyOperation(browserLoad(), operation);
    browserSave(data);
    window.dispatchEvent(new CustomEvent("deskbox-browser-data", { detail: { revision: data.revision, operation } satisfies AppDataChange }));
    return { revision: data.revision };
  },
  async pickPath(): Promise<string | null> { return isTauri() ? invoke<string | null>("pick_shortcut_path") : null; },
  async pickBackgroundMedia(): Promise<BackgroundMediaSelection | null> {
    if (isTauri()) return invoke<BackgroundMediaSelection | null>("pick_background_media");
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        const kind = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : backgroundKindFromFileName(file.name);
        if (!kind) { resolve(null); return; }
        const reader = new FileReader();
        reader.onload = () => resolve({ kind, assetPath: String(reader.result), assetName: file.name });
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      };
      input.click();
    });
  },
  async deleteBackgroundAsset(assetPath: string): Promise<void> { if (isTauri()) await invoke("delete_background_asset", { assetPath }); },
  backgroundUrl(assetPath: string | null): string | null {
    if (!assetPath) return null;
    if (assetPath.startsWith("data:")) return assetPath;
    return isTauri() ? convertFileSrc(assetPath) : null;
  },
  async resolveShortcut(path: string): Promise<ShortcutInfo> {
    if (!isTauri()) return { name: path.split(/[\\/]/).pop()?.replace(/\.lnk$/i, "") ?? path, targetPath: path, arguments: null, workingDirectory: null };
    return invoke<ShortcutInfo>("resolve_shortcut", { path });
  },
  async isDirectory(path: string): Promise<boolean> { return isTauri() ? invoke<boolean>("is_directory", { path }) : false; },
  async getFileName(path: string): Promise<string> {
    if (isTauri()) return invoke<string>("get_file_name", { path });
    return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  },
  async extractIcon(path: string): Promise<string | null> { return isTauri() ? invoke<string | null>("extract_icon", { path }) : null; },
  async launchPath(path: string): Promise<void> {
    if (!isTauri()) return;
    await invoke("launch_path", { path });
  },
  async launchShortcut(shortcutId: string): Promise<AppData> {
    if (isTauri()) return invoke<AppData>("launch_shortcut", { shortcutId });
    const current = browserLoad();
    const shortcut = current.containers.flatMap((container) => container.shortcuts).find((item) => item.id === shortcutId);
    if (shortcut) { shortcut.launchCount += 1; shortcut.lastLaunchedAt = Date.now(); current.revision += 1; browserSave(current); }
    return current;
  },
  async reveal(path: string): Promise<void> { if (isTauri()) await invoke("reveal_in_explorer", { path }); },
  async configureWatcher(enabled: boolean): Promise<void> { if (isTauri()) await invoke("configure_desktop_watcher", { enabled }); },
  async recycleSource(path: string): Promise<void> { if (isTauri()) await invoke("recycle_source", { path }); },
  async hidePath(path: string): Promise<void> { if (isTauri()) await invoke("hide_path", { path }); },
  async showPath(path: string): Promise<void> { if (isTauri()) await invoke("show_path", { path }); },
  async togglePathHidden(path: string): Promise<boolean> { return isTauri() ? invoke<boolean>("toggle_path_hidden", { path }) : false; },
  async getPathHidden(path: string): Promise<boolean> { return isTauri() ? invoke<boolean>("get_path_hidden", { path }) : false; },
  async hidePaths(paths: string[]): Promise<number> { return isTauri() ? invoke<number>("hide_paths", { paths }) : paths.filter((path) => !/^https?:\/\//i.test(path)).length; },
  async showPaths(paths: string[]): Promise<number> { return isTauri() ? invoke<number>("show_paths", { paths }) : paths.filter((path) => !/^https?:\/\//i.test(path)).length; },
  async exportBackup(): Promise<string | null> {
    if (isTauri()) return invoke<string | null>("export_backup");
    const blob = new Blob([JSON.stringify(browserLoad(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "deskbox-backup.json"; anchor.click();
    URL.revokeObjectURL(url);
    return anchor.download;
  },
  async importBackup(): Promise<AppData | null> { return isTauri() ? invoke<AppData | null>("import_backup") : null; },
  async openBackupDirectory(): Promise<void> { if (isTauri()) await invoke("open_backup_directory"); },
  async runtimeError(): Promise<string | null> { return isTauri() ? invoke<string | null>("get_runtime_status") : null; },
  async onDesktopFile(callback: (path: string) => void): Promise<UnlistenFn> {
    if (!isTauri()) return () => undefined;
    return listen<string>("desktop-file-created", (event) => callback(event.payload));
  },
  async onAppDataChanged(callback: (change: AppDataChange) => void): Promise<UnlistenFn> {
    if (isTauri()) return listen<AppDataChange>("app-data-changed", (event) => callback(event.payload));
    const handler = (event: Event) => callback((event as CustomEvent<AppDataChange>).detail);
    window.addEventListener("deskbox-browser-data", handler);
    return () => window.removeEventListener("deskbox-browser-data", handler);
  },
  async onQuickLaunchReset(callback: () => void): Promise<UnlistenFn> {
    if (!isTauri()) return () => undefined;
    return listen("quick-launch-reset", callback);
  },
  async onOpenSettings(callback: () => void): Promise<UnlistenFn> {
    if (isTauri()) return listen("open-settings", callback);
    const handler = () => callback();
    window.addEventListener("deskbox-open-settings", handler);
    return () => window.removeEventListener("deskbox-open-settings", handler);
  },
  currentWindowLabel(): string { return isTauri() ? getCurrentWindow().label : new URLSearchParams(location.search).get("window") ?? "main"; },
  currentContainerId(): string | null {
    const label = this.currentWindowLabel();
    if (label.startsWith("container-")) return label.slice("container-".length);
    return new URLSearchParams(location.search).get("containerId");
  },
  async createContainerWindow(containerId: string): Promise<void> { if (isTauri()) await invoke("create_container_window", { containerId }); },
  async hideContainerWindow(containerId: string): Promise<void> { if (isTauri()) await invoke("hide_container_window", { containerId }); },
  async getContainerWindowSettings(containerId: string): Promise<ContainerWindowSettings> {
    if (isTauri()) return invoke<ContainerWindowSettings>("get_container_window_settings", { containerId });
    const key = `deskbox-window-${containerId}`;
    const stored = localStorage.getItem(key);
    if (stored) { try { return { monitorKey: null, x: 140, y: 120, width: 420, height: 360, collapsed: false, locked: false, opacity: 100, clickThrough: false, snapEdge: "none", autoHide: false, docked: false, dockSide: null, layout: "grid", skipTaskbar: false, allWorkspaces: false, ...JSON.parse(stored) }; } catch { /* use defaults */ } }
    return { monitorKey: null, x: 140, y: 120, width: 420, height: 360, collapsed: false, locked: false, opacity: 100, clickThrough: false, snapEdge: "none", autoHide: false, docked: false, dockSide: null, layout: "grid", skipTaskbar: false, allWorkspaces: false };
  },
  async launchExternalItem(targetType: LaunchTargetType, target: string): Promise<void> {
    if (isTauri()) await invoke("launch_external_item", { targetType, target });
  },
  async getSystemAppCatalog(refresh = false): Promise<SystemAppCatalogItem[]> {
    if (isTauri()) return invoke<SystemAppCatalogItem[]>("get_system_app_catalog", { refresh });
    return [
      { key: "system:browser-calculator", name: "计算器", targetType: "path", target: "C:\\Windows\\System32\\calc.exe", sourcePath: "C:\\Windows\\System32\\calc.exe", icon: null },
      { key: "system:browser-photoshop", name: "Adobe Photoshop", targetType: "path", target: "C:\\Program Files\\Adobe\\Photoshop.exe", sourcePath: null, icon: null },
    ];
  },
  async refreshSystemAppCatalog(): Promise<SystemAppCatalogItem[]> {
    if (isTauri()) return invoke<SystemAppCatalogItem[]>("refresh_system_app_catalog");
    return this.getSystemAppCatalog(true);
  },
  async searchEverything(query: string, limit = 30): Promise<EverythingSearchItem[]> {
    if (isTauri()) return invoke<EverythingSearchItem[]>("search_everything", { query, limit });
    const samples: EverythingSearchItem[] = [
      { key: "file:c:\\users\\demo\\documents\\deskbox-notes.txt", name: "deskbox-notes.txt", path: "C:\\Users\\demo\\Documents\\deskbox-notes.txt", isDirectory: false },
      { key: "file:c:\\users\\demo\\downloads", name: "Downloads", path: "C:\\Users\\demo\\Downloads", isDirectory: true },
    ];
    const needle = query.trim().toLocaleLowerCase();
    return samples.filter((item) => `${item.name}\n${item.path}`.toLocaleLowerCase().includes(needle)).slice(0, limit);
  },
  async detectEverything(): Promise<EverythingDetection> {
    return isTauri() ? invoke<EverythingDetection>("detect_everything") : { installed: false, running: false, executablePath: null, message: "浏览器预览不连接 Everything" };
  },
  async setHotkeyBinding(action: HotkeyAction, accelerator: string | null): Promise<AppData> {
    if (isTauri()) return invoke<AppData>("set_hotkey_binding", { action, accelerator });
    const data = browserLoad();
    if (action === "mainWindow") data.settings.hotkeys.mainWindow = accelerator;
    else if (action === "quickLaunch") data.settings.hotkeys.quickLaunch = accelerator;
    else if (action === "toggleContainers") data.settings.hotkeys.toggleContainers = accelerator;
    else if (action === "settings") data.settings.hotkeys.settings = accelerator;
    else { const container = data.containers.find((item) => item.id === action.slice("container:".length)); if (container) container.hotkey = accelerator; }
    data.revision += 1;
    browserSave(data);
    window.dispatchEvent(new CustomEvent("deskbox-browser-data", { detail: { revision: data.revision, operation: null } satisfies AppDataChange }));
    return data;
  },
  async getHotkeyStatuses(): Promise<HotkeyStatus[]> {
    if (isTauri()) return invoke<HotkeyStatus[]>("get_hotkey_statuses");
    const data = browserLoad();
    const containerValues: Array<[HotkeyAction, string | null]> = data.containers.map((item) => [`container:${item.id}`, item.hotkey]);
    const values: Array<[HotkeyAction, string | null]> = [["mainWindow", data.settings.hotkeys.mainWindow], ["quickLaunch", data.settings.hotkeys.quickLaunch], ["toggleContainers", data.settings.hotkeys.toggleContainers], ["settings", data.settings.hotkeys.settings], ...containerValues];
    return values.map(([action, accelerator]) => ({ action, accelerator, state: accelerator ? "active" : "unassigned", message: null }));
  },
  async updateContainerWindowSettings(containerId: string, settings: ContainerWindowSettings): Promise<ContainerWindowSettings> {
    if (isTauri()) return invoke<ContainerWindowSettings>("update_container_window_settings", { containerId, settings });
    localStorage.setItem(`deskbox-window-${containerId}`, JSON.stringify(settings));
    return settings;
  },
  async updateContainerWindowOpacity(containerId: string, opacity: number): Promise<ContainerWindowSettings> {
    if (isTauri()) return invoke<ContainerWindowSettings>("update_container_window_opacity", { containerId, opacity });
    const settings = await this.getContainerWindowSettings(containerId);
    settings.opacity = opacity;
    localStorage.setItem(`deskbox-window-${containerId}`, JSON.stringify(settings));
    return settings;
  },
  async revealContainerWindowDock(containerId: string): Promise<ContainerWindowSettings> {
    if (isTauri()) return invoke<ContainerWindowSettings>("reveal_container_window_dock", { containerId });
    return this.getContainerWindowSettings(containerId);
  },
  async dockContainerWindow(containerId: string): Promise<ContainerWindowSettings> {
    if (isTauri()) return invoke<ContainerWindowSettings>("dock_container_window", { containerId });
    return this.getContainerWindowSettings(containerId);
  },
  async getWallpaperDominantColor(): Promise<string | null> {
    return isTauri() ? invoke<string | null>("get_wallpaper_dominant_color") : null;
  },
  async showAllContainerWindows(): Promise<void> { if (isTauri()) await invoke("show_all_container_windows"); },
  async hideAllContainerWindows(): Promise<void> { if (isTauri()) await invoke("hide_all_container_windows"); },
  async listMonitors(): Promise<MonitorInfo[]> { return isTauri() ? invoke<MonitorInfo[]>("list_monitors") : []; },
  async setContainerWindowPinned(containerId: string, pinned: boolean): Promise<void> { if (isTauri()) await invoke("set_container_window_pinned", { containerId, pinned }); },
  async restoreContainerMouseInteraction(): Promise<void> { if (isTauri()) await invoke("restore_container_mouse_interaction"); },
  async hasContainerMouseInteractionBlocked(): Promise<boolean> { return isTauri() ? invoke<boolean>("has_container_mouse_interaction_blocked") : false; },
  async showQuickLaunch(): Promise<void> { if (isTauri()) await invoke("show_quick_launch"); },
  async showSettings(): Promise<void> { if (isTauri()) await invoke("show_settings_window"); else window.dispatchEvent(new Event("deskbox-open-settings")); },
  async toggleAllContainerWindows(): Promise<void> { if (isTauri()) await invoke("toggle_all_container_windows"); },
  async minimize(): Promise<void> { if (isTauri()) await getCurrentWindow().minimize(); },
  async close(): Promise<void> { if (isTauri()) await getCurrentWindow().close(); },
  async startDragging(): Promise<void> { if (isTauri()) await getCurrentWindow().startDragging(); },
  async hide(): Promise<void> { if (isTauri()) await getCurrentWindow().hide(); },
};
