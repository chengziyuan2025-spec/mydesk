import { useCallback, useEffect, useMemo, useRef } from "react";
import { createId } from "../data/defaults";
import { applyOperation } from "../data/operations";
import { platform } from "../services/platform";
import { useDeskBoxStore } from "../stores/useDeskBoxStore";
import type { AppData, AppOperation, ExternalLauncherEntry, LaunchTargetType, Settings, ShortcutItem, ToastMessage } from "../types";

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const normalizedPath = (path: string) => path.replaceAll("/", "\\").toLocaleLowerCase();

interface DeskBoxOptions { enableDesktopWatcher?: boolean }

export interface AddShortcutOptions {
  source?: ShortcutItem["source"];
  arguments?: string | null;
  workingDirectory?: string | null;
  sourcePath?: string | null;
  hideSource?: boolean;
  notify?: boolean;
  targetType?: LaunchTargetType;
}

export function useDeskBox({ enableDesktopWatcher = true }: DeskBoxOptions = {}) {
  const data = useDeskBoxStore((state) => state.data);
  const toasts = useDeskBoxStore((state) => state.toasts);
  const saveState = useDeskBoxStore((state) => state.saveState);
  const setData = useDeskBoxStore((state) => state.setData);
  const setToasts = useDeskBoxStore((state) => state.setToasts);
  const setSaveState = useDeskBoxStore((state) => state.setSaveState);
  const dataRef = useRef<AppData | null>(null);
  const collectingRef = useRef(new Set<string>());

  useEffect(() => { dataRef.current = data; }, [data]);

  const notify = useCallback((message: string, type: ToastMessage["type"] = "info", action?: Pick<ToastMessage, "actionLabel" | "onAction">) => {
    const id = createId("toast");
    setToasts((current) => [...current, { id, message, type, ...action }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), action ? 6500 : 3400);
  }, []);

  const refresh = useCallback(async () => {
    const latest = await platform.loadData();
    if (!dataRef.current || latest.revision >= dataRef.current.revision) {
      dataRef.current = latest;
      setData(latest);
    }
    return latest;
  }, []);

  useEffect(() => {
    void refresh().catch((error) => notify(`读取数据失败：${errorText(error)}`, "error"));
    void platform.runtimeError().then((message) => message && notify(message, "error"));
  }, [notify, refresh]);

  useEffect(() => {
    let unlisten: () => void = () => undefined;
    let disposed = false;
    void platform.onAppDataChanged((change) => {
      const current = dataRef.current;
      if ((current?.revision ?? -1) >= change.revision) return;
      if (current && change.operation && change.revision === current.revision + 1) {
        const next = applyOperation(current, change.operation);
        dataRef.current = next;
        setData(next);
        return;
      }
      void refresh().catch((error) => notify(`同步数据失败：${errorText(error)}`, "error"));
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; });
    return () => { disposed = true; unlisten(); };
  }, [notify, refresh]);

  const runOperation = useCallback(async (operation: AppOperation) => {
    const before = dataRef.current;
    if (before) {
      const optimistic = applyOperation(before, operation);
      dataRef.current = optimistic;
      setData(optimistic);
    }
    setSaveState("saving");
    try {
      const commit = await platform.applyOperation(operation);
      if (!dataRef.current || dataRef.current.revision !== commit.revision) await refresh();
      setSaveState("saved");
      return commit;
    } catch (error) {
      setSaveState("error");
      await refresh().catch(() => undefined);
      notify(`保存失败：${errorText(error)}`, "error");
      throw error;
    }
  }, [notify, refresh]);

  const collectDesktopFile = useCallback(async (path: string) => {
    const current = dataRef.current;
    if (!current?.settings.autoCollect) return;
    const key = normalizedPath(path);
    if (collectingRef.current.has(key) || current.containers.some((container) => container.shortcuts.some((item) => normalizedPath(item.path) === key))) return;
    collectingRef.current.add(key);
    try {
      const targetId = current.settings.defaultContainerId || current.containers[0]?.id;
      if (!targetId) throw new Error("请先创建一个容器");
      const fileName = path.split(/[\\/]/).pop() ?? path;
      const name = fileName.replace(/\.(lnk|exe)$/i, "");
      const shortcut: ShortcutItem = { id: createId("shortcut"), name, path, targetType: /^https?:\/\//i.test(path) ? "url" : "path", aliases: [], favorite: false, sourcePath: null, source: "manual", arguments: null, workingDirectory: null, icon: null, createdAt: Date.now(), launchCount: 0, lastLaunchedAt: null };
      await runOperation({ type: "addShortcut", containerId: targetId, shortcut });
      notify(`已自动收纳「${name}」`, "success");
      if (current.settings.deleteSource) await platform.recycleSource(path).catch((error) => notify(`源文件保留：${errorText(error)}`, "error"));
    } catch (error) { notify(`自动收纳失败：${errorText(error)}`, "error"); }
    finally { collectingRef.current.delete(key); }
  }, [notify, runOperation]);

  useEffect(() => {
    if (!data || !enableDesktopWatcher) return;
    void platform.configureWatcher(data.settings.autoCollect).catch((error) => notify(`桌面监听启动失败：${errorText(error)}`, "error"));
  }, [data?.settings.autoCollect, enableDesktopWatcher, notify]);

  useEffect(() => {
    if (!enableDesktopWatcher) return;
    let unlisten: () => void = () => undefined;
    void platform.onDesktopFile(collectDesktopFile).then((stop) => { unlisten = stop; });
    return () => unlisten();
  }, [collectDesktopFile, enableDesktopWatcher]);

  const actions = useMemo(() => ({
    async addContainer(name: string) {
      const id = createId("container");
      await runOperation({ type: "addContainer", container: { id, name, hidden: false, pinned: false, aliases: [], favorite: false, openCount: 0, lastOpenedAt: null, hotkey: null, shortcuts: [] } });
      notify(`容器「${name}」已创建`, "success");
    },
    renameContainer: (containerId: string, name: string) => runOperation({ type: "renameContainer", containerId, name }),
    async deleteContainer(containerId: string) {
      const trashId = createId("trash");
      await runOperation({ type: "deleteContainer", containerId, trashId, deletedAt: Date.now() });
      notify("容器已移入回收站", "success", { actionLabel: "撤销", onAction: () => void runOperation({ type: "restoreTrash", trashId }) });
    },
    async deleteShortcut(containerId: string, shortcutId: string) {
      const trashId = createId("trash");
      await runOperation({ type: "deleteShortcut", containerId, shortcutId, trashId, deletedAt: Date.now() });
      notify("快捷方式已移入回收站", "success", { actionLabel: "撤销", onAction: () => void runOperation({ type: "restoreTrash", trashId }) });
    },
    setContainerHidden: (containerId: string, hidden: boolean) => runOperation({ type: "setContainerHidden", containerId, hidden }),
    setContainerPinned: (containerId: string, pinned: boolean) => runOperation({ type: "setContainerPinned", containerId, pinned }),
    setShortcutLauncherMeta: (shortcutId: string, aliases: string[], favorite: boolean) => runOperation({ type: "setShortcutLauncherMeta", shortcutId, aliases, favorite }),
    setContainerLauncherMeta: (containerId: string, aliases: string[], favorite: boolean) => runOperation({ type: "setContainerLauncherMeta", containerId, aliases, favorite }),
    recordContainerOpened: (containerId: string) => runOperation({ type: "recordContainerOpened", containerId, openedAt: Date.now() }),
    upsertExternalLauncherEntry: (entry: ExternalLauncherEntry) => runOperation({ type: "upsertExternalLauncherEntry", entry }),
    removeExternalLauncherEntry: (key: string) => runOperation({ type: "removeExternalLauncherEntry", key }),
    reorderContainer: (containerId: string, beforeContainerId: string | null) => runOperation({ type: "reorderContainer", containerId, beforeContainerId }),
    moveShortcut: (shortcutId: string, targetContainerId: string, beforeShortcutId: string | null = null) => runOperation({ type: "moveShortcut", shortcutId, targetContainerId, beforeShortcutId }),
    async addShortcut(containerId: string, name: string, path: string, options: AddShortcutOptions = {}) {
      const shortcut: ShortcutItem = {
        id: createId("shortcut"), name, path,
        targetType: options.targetType ?? (/^https?:\/\//i.test(path) ? "url" : "path"), aliases: [], favorite: false,
        sourcePath: options.sourcePath ?? null,
        source: options.source ?? "manual",
        arguments: options.arguments ?? null,
        workingDirectory: options.workingDirectory ?? null,
        // Icons are resolved lazily by visible tiles and never persisted in AppData.
        icon: null, createdAt: Date.now(), launchCount: 0, lastLaunchedAt: null,
      };
      await runOperation({ type: "addShortcut", containerId, shortcut });
      if (options.hideSource) await platform.hidePath(options.sourcePath ?? path);
      if (options.notify !== false) notify(`「${name}」已添加`, "success");
    },
    updateSettings: (settings: Settings) => runOperation({ type: "updateSettings", settings }),
    restoreTrash: (trashId: string) => runOperation({ type: "restoreTrash", trashId }),
    permanentDeleteTrash: (trashId: string) => runOperation({ type: "permanentDeleteTrash", trashId }),
    emptyTrash: () => runOperation({ type: "emptyTrash" }),
    async launchShortcut(shortcutId: string) {
      try {
        const latest = await platform.launchShortcut(shortcutId);
        if (!dataRef.current || latest.revision >= dataRef.current.revision) { setData(latest); dataRef.current = latest; }
      }
      catch (error) { notify(`无法打开：${errorText(error)}`, "error"); }
    },
    async launchPath(path: string) { await platform.launchPath(path).catch((error) => notify(`无法打开：${errorText(error)}`, "error")); },
    async reveal(path: string) { await platform.reveal(path).catch((error) => notify(`无法定位：${errorText(error)}`, "error")); },
    async exportBackup() { const result = await platform.exportBackup(); if (result) notify("备份已导出", "success"); },
    async importBackup() { const latest = await platform.importBackup(); if (latest) { setData(latest); dataRef.current = latest; notify("备份已导入", "success"); } },
    openBackupDirectory: () => platform.openBackupDirectory(),
  }), [notify, runOperation]);

  return { data, actions, toasts, saveState, notify };
}
