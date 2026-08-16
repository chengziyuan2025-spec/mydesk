import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createId } from "../data/defaults";
import { applyOperation } from "../data/operations";
import { platform } from "../services/platform";
import type { AppData, AppOperation, Settings, ShortcutItem, ToastMessage } from "../types";

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const normalizedPath = (path: string) => path.replaceAll("/", "\\").toLocaleLowerCase();

interface DeskBoxOptions { enableDesktopWatcher?: boolean }

export interface AddShortcutOptions {
  source?: ShortcutItem["source"];
  arguments?: string | null;
  workingDirectory?: string | null;
  icon?: string | null;
  notify?: boolean;
}

export function useDeskBox({ enableDesktopWatcher = true }: DeskBoxOptions = {}) {
  const [data, setData] = useState<AppData | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const dataRef = useRef<AppData | null>(null);
  const collectingRef = useRef(new Set<string>());
  const iconRequestsRef = useRef(new Set<string>());

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
    void platform.onAppDataChanged((revision) => {
      if ((dataRef.current?.revision ?? -1) >= revision) return;
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
      const latest = await platform.applyOperation(operation);
      if (!dataRef.current || latest.revision >= dataRef.current.revision) {
        dataRef.current = latest;
        setData(latest);
      }
      setSaveState("saved");
      return latest;
    } catch (error) {
      setSaveState("error");
      await refresh().catch(() => undefined);
      notify(`保存失败：${errorText(error)}`, "error");
      throw error;
    }
  }, [notify, refresh]);

  useEffect(() => {
    if (!data || !platform.isDesktop()) return;
    for (const shortcut of data.containers.flatMap((container) => container.shortcuts.filter((item) => !item.icon))) {
      if (iconRequestsRef.current.has(shortcut.id)) continue;
      iconRequestsRef.current.add(shortcut.id);
      void platform.extractIcon(shortcut.path)
        .then((icon) => icon ? runOperation({ type: "updateShortcutIcon", shortcutId: shortcut.id, icon }) : null)
        .catch(() => undefined);
    }
  }, [data, runOperation]);

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
      const icon = await platform.extractIcon(path).catch(() => null);
      const shortcut: ShortcutItem = { id: createId("shortcut"), name, path, source: "manual", arguments: null, workingDirectory: null, icon, createdAt: Date.now(), launchCount: 0, lastLaunchedAt: null };
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
      await runOperation({ type: "addContainer", container: { id, name, hidden: false, pinned: false, shortcuts: [] } });
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
    reorderContainer: (containerId: string, beforeContainerId: string | null) => runOperation({ type: "reorderContainer", containerId, beforeContainerId }),
    moveShortcut: (shortcutId: string, targetContainerId: string, beforeShortcutId: string | null = null) => runOperation({ type: "moveShortcut", shortcutId, targetContainerId, beforeShortcutId }),
    async addShortcut(containerId: string, name: string, path: string, options: AddShortcutOptions = {}) {
      const icon = options.icon === undefined ? await platform.extractIcon(path).catch(() => null) : options.icon;
      const shortcut: ShortcutItem = {
        id: createId("shortcut"), name, path,
        source: options.source ?? "manual",
        arguments: options.arguments ?? null,
        workingDirectory: options.workingDirectory ?? null,
        icon, createdAt: Date.now(), launchCount: 0, lastLaunchedAt: null,
      };
      await runOperation({ type: "addShortcut", containerId, shortcut });
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
