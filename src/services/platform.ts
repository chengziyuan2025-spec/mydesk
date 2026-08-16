import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppData, AppOperation } from "../types";
import { createDefaultData } from "../data/defaults";
import { applyOperation, migrateBrowserData } from "../data/operations";

const STORAGE_KEY = "deskbox-browser-data";
const isTauri = () => "__TAURI_INTERNALS__" in window;

const browserLoad = (): AppData => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return createDefaultData();
  try { return migrateBrowserData(JSON.parse(stored)); }
  catch { return createDefaultData(); }
};

const browserSave = (data: AppData) => localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

export const platform = {
  isDesktop: isTauri,
  async loadData(): Promise<AppData> { return isTauri() ? invoke<AppData>("load_app_data") : browserLoad(); },
  async applyOperation(operation: AppOperation): Promise<AppData> {
    if (isTauri()) return invoke<AppData>("apply_app_operation", { operation });
    const data = applyOperation(browserLoad(), operation);
    browserSave(data);
    window.dispatchEvent(new CustomEvent("deskbox-browser-data", { detail: data.revision }));
    return data;
  },
  async pickPath(): Promise<string | null> { return isTauri() ? invoke<string | null>("pick_shortcut_path") : null; },
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
  async onAppDataChanged(callback: (revision: number) => void): Promise<UnlistenFn> {
    if (isTauri()) return listen<number>("app-data-changed", (event) => callback(event.payload));
    const handler = (event: Event) => callback((event as CustomEvent<number>).detail);
    window.addEventListener("deskbox-browser-data", handler);
    return () => window.removeEventListener("deskbox-browser-data", handler);
  },
  async onQuickLaunchReset(callback: () => void): Promise<UnlistenFn> {
    if (!isTauri()) return () => undefined;
    return listen("quick-launch-reset", callback);
  },
  currentWindowLabel(): string { return isTauri() ? getCurrentWindow().label : new URLSearchParams(location.search).get("window") ?? "main"; },
  currentContainerId(): string | null {
    const label = this.currentWindowLabel();
    if (label.startsWith("container-")) return label.slice("container-".length);
    return new URLSearchParams(location.search).get("containerId");
  },
  async createContainerWindow(containerId: string): Promise<void> { if (isTauri()) await invoke("create_container_window", { containerId }); },
  async hideContainerWindow(containerId: string): Promise<void> { if (isTauri()) await invoke("hide_container_window", { containerId }); },
  async showQuickLaunch(): Promise<void> { if (isTauri()) await invoke("show_quick_launch"); },
  async minimize(): Promise<void> { if (isTauri()) await getCurrentWindow().minimize(); },
  async close(): Promise<void> { if (isTauri()) await getCurrentWindow().close(); },
  async startDragging(): Promise<void> { if (isTauri()) await getCurrentWindow().startDragging(); },
  async hide(): Promise<void> { if (isTauri()) await getCurrentWindow().hide(); },
};
