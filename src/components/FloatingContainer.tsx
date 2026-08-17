import { useCallback, useEffect, useRef, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Archive, Eye, EyeOff, GripVertical, Lock, Maximize2, Minimize2, MoreHorizontal, MousePointer2, Pencil, Pin, PinOff, Plus, Unlock, X } from "lucide-react";
import { normalizeShortcutTarget, parseDroppedUrls, shortcutNameFromTarget, uniqueShortcutCandidates, type ShortcutCandidate } from "../data/externalDrop";
import { useDeskBox } from "../hooks/useDeskBox";
import type { AppData, ContainerItem, ContainerWindowSettings, ShortcutItem } from "../types";
import { platform } from "../services/platform";
import { beginInteraction } from "../data/performance";
import { IconButton } from "./IconButton";
import { ShortcutTile } from "./ShortcutTile";
import { ToastStack } from "./ToastStack";
import { VirtualGrid } from "./VirtualGrid";

interface FloatingContainerProps {
  containerId: string;
  onBeforeAdd?: (candidate: ShortcutCandidate) => Promise<ShortcutCandidate | boolean | void>;
}

function SortableTile({ shortcut, container, data, onLaunch, onReveal, onDelete, onToggleSource, onMove }: {
  shortcut: ShortcutItem; container: ContainerItem; data: AppData;
  onLaunch: (shortcut: ShortcutItem) => void; onReveal: (shortcut: ShortcutItem) => void; onDelete: (shortcut: ShortcutItem) => void; onToggleSource: (shortcut: ShortcutItem) => void; onMove: (shortcut: ShortcutItem, target: string) => void;
}) {
  const sortable = useSortable({ id: shortcut.id });
  return <div ref={sortable.setNodeRef} className={`floating-sortable ${sortable.isDragging ? "is-dragging" : ""}`} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}>
    <button type="button" className="shortcut-drag-handle" aria-label={`拖动 ${shortcut.name}`} title="拖动快捷方式" {...sortable.attributes} {...sortable.listeners}><GripVertical size={12} /></button>
    <ShortcutTile shortcut={shortcut} containers={data.containers} containerId={container.id} onLaunch={onLaunch} onReveal={onReveal} onDelete={onDelete} onToggleSource={onToggleSource} onMove={onMove} />
  </div>;
}

export function FloatingContainer({ containerId, onBeforeAdd }: FloatingContainerProps) {
  const { data, actions, saveState, toasts, notify } = useDeskBox({ enableDesktopWatcher: false });
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [externalDragActive, setExternalDragActive] = useState(false);
  const [windowSettings, setWindowSettings] = useState<ContainerWindowSettings | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [allSourcesHidden, setAllSourcesHidden] = useState(false);
  const [activeShortcutId, setActiveShortcutId] = useState<string | null>(null);
  const dockTimerRef = useRef<number | null>(null);
  const pointerActiveRef = useRef(false);
  const windowSettingsRef = useRef<ContainerWindowSettings | null>(null);
  const windowSettingsFrameRef = useRef<number | null>(null);
  const windowSettingsRequestRef = useRef(0);
  const opacityFrameRef = useRef<number | null>(null);
  const opacityRequestRef = useRef(0);
  const activeContainerId = platform.currentContainerId() ?? containerId;
  const container = data?.containers.find((item) => item.id === activeContainerId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => { void platform.getContainerWindowSettings(activeContainerId).then((settings) => { windowSettingsRef.current = settings; setWindowSettings(settings); }).catch(() => undefined); }, [activeContainerId]);
  const patchWindow = useCallback((patch: Partial<ContainerWindowSettings>) => {
    const current = windowSettingsRef.current;
    if (!current) return;
    const next = { ...current, ...patch };
    windowSettingsRef.current = next;
    setWindowSettings(next);
    if (windowSettingsFrameRef.current !== null) return;
    windowSettingsFrameRef.current = window.requestAnimationFrame(() => {
      windowSettingsFrameRef.current = null;
      const pending = windowSettingsRef.current;
      if (!pending) return;
      const requestId = ++windowSettingsRequestRef.current;
      void platform.updateContainerWindowSettings(activeContainerId, pending).then((saved) => {
        if (requestId !== windowSettingsRequestRef.current || windowSettingsRef.current !== pending) return;
        windowSettingsRef.current = saved;
        setWindowSettings(saved);
      }).catch(() => notify("窗口设置保存失败", "error"));
    });
  }, [activeContainerId, notify]);
  const patchOpacity = useCallback((opacity: number) => {
    const current = windowSettingsRef.current;
    if (!current) return;
    windowSettingsRef.current = { ...current, opacity };
    setWindowSettings(windowSettingsRef.current);
    if (opacityFrameRef.current !== null) return;
    opacityFrameRef.current = window.requestAnimationFrame(() => {
      opacityFrameRef.current = null;
      const pendingOpacity = windowSettingsRef.current?.opacity;
      if (pendingOpacity === undefined) return;
      const requestId = ++opacityRequestRef.current;
      void platform.updateContainerWindowOpacity(activeContainerId, pendingOpacity).then((saved) => {
        if (requestId !== opacityRequestRef.current || windowSettingsRef.current?.opacity !== pendingOpacity) return;
        windowSettingsRef.current = { ...windowSettingsRef.current, opacity: saved.opacity };
        setWindowSettings(windowSettingsRef.current);
      }).catch(() => notify("透明度保存失败", "error"));
    });
  }, [activeContainerId, notify]);
  const clearDockTimer = useCallback(() => {
    if (dockTimerRef.current !== null) window.clearTimeout(dockTimerRef.current);
    dockTimerRef.current = null;
  }, []);
  const revealDock = useCallback(() => {
    clearDockTimer();
    if (!windowSettings?.autoHide) return;
    void platform.revealContainerWindowDock(activeContainerId).then(setWindowSettings).catch(() => undefined);
  }, [activeContainerId, clearDockTimer, windowSettings?.autoHide]);
  const scheduleDock = useCallback(() => {
    clearDockTimer();
    if (pointerActiveRef.current || !windowSettings?.autoHide || !windowSettings.dockSide) return;
    dockTimerRef.current = window.setTimeout(() => {
      dockTimerRef.current = null;
      if (pointerActiveRef.current) return;
      void platform.dockContainerWindow(activeContainerId).then(setWindowSettings).catch(() => undefined);
    }, 1_000);
  }, [activeContainerId, clearDockTimer, windowSettings]);

  const launchShortcut = useCallback((shortcut: ShortcutItem) => { void actions.launchShortcut(shortcut.id); }, [actions]);
  const revealShortcut = useCallback((shortcut: ShortcutItem) => { void actions.reveal(shortcut.path); }, [actions]);
  const deleteShortcut = useCallback((shortcut: ShortcutItem) => { void actions.deleteShortcut(activeContainerId, shortcut.id); }, [actions, activeContainerId]);
  const toggleShortcutSource = useCallback((shortcut: ShortcutItem) => { void platform.togglePathHidden(shortcut.sourcePath ?? shortcut.path).then((hidden) => notify(hidden ? "源文件已隐藏" : "源文件已恢复显示", "success")).catch((error) => notify(`切换源文件显示失败：${String(error)}`, "error")); }, [notify]);
  const moveShortcut = useCallback((shortcut: ShortcutItem, target: string) => { void actions.moveShortcut(shortcut.id, target); }, [actions]);

  useEffect(() => () => {
    clearDockTimer();
    if (windowSettingsFrameRef.current !== null) window.cancelAnimationFrame(windowSettingsFrameRef.current);
    if (opacityFrameRef.current !== null) window.cancelAnimationFrame(opacityFrameRef.current);
  }, [clearDockTimer]);
  useEffect(() => {
    const releasePointer = () => {
      pointerActiveRef.current = false;
      const shell = document.querySelector<HTMLElement>(".floating-shell");
      if (shell && !shell.matches(":hover")) scheduleDock();
    };
    window.addEventListener("pointerup", releasePointer);
    window.addEventListener("pointercancel", releasePointer);
    return () => {
      window.removeEventListener("pointerup", releasePointer);
      window.removeEventListener("pointercancel", releasePointer);
    };
  }, [scheduleDock]);
  useEffect(() => {
    if (!moreOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest(".floating-more") && !target.closest('[data-window-control="more"]')) setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMoreOpen(false); };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [moreOpen]);

  const addCandidates = useCallback(async (candidates: ShortcutCandidate[], preparationFailures = 0) => {
    if (!container || (!candidates.length && !preparationFailures)) return;
    const seen = new Set(container.shortcuts.map((item) => normalizeShortcutTarget(item.path)));
    const uniqueCandidates = uniqueShortcutCandidates(candidates, seen);
    let added = 0;
    let duplicates = candidates.length - uniqueCandidates.length;
    let skipped = 0;
    let failed = preparationFailures;

    for (const initialCandidate of uniqueCandidates) {
      try {
        let candidate = initialCandidate;
        if (onBeforeAdd) {
          const result = await onBeforeAdd(candidate);
          if (result === false) {
            skipped += 1;
            continue;
          }
          if (result && typeof result === "object") candidate = result;
        }
        const key = normalizeShortcutTarget(candidate.path);
        if (!key || seen.has(key)) {
          duplicates += 1;
          continue;
        }
        await actions.addShortcut(container.id, candidate.name, candidate.path, {
          source: candidate.source,
          sourcePath: candidate.sourcePath,
          arguments: candidate.arguments,
          workingDirectory: candidate.workingDirectory,
          notify: false,
        });
        seen.add(key);
        added += 1;
      } catch {
        failed += 1;
      }
    }

    const summary = [
      added ? `已添加 ${added} 个` : "",
      duplicates ? `跳过 ${duplicates} 个重复项` : "",
      skipped ? `取消 ${skipped} 个` : "",
      failed ? `${failed} 个添加失败` : "",
    ].filter(Boolean).join("，");
    notify(summary || "没有可添加的项目", failed ? "error" : added ? "success" : "info");
  }, [actions, container, notify, onBeforeAdd]);

  const candidatesFromPaths = useCallback(async (paths: string[]) => {
    const candidates: ShortcutCandidate[] = [];
    let failures = 0;
    for (const droppedPath of paths) {
      try {
        if (/\.lnk$/i.test(droppedPath)) {
          const info = await platform.resolveShortcut(droppedPath);
          if (!info.targetPath) throw new Error("快捷方式没有目标路径");
          candidates.push({
            name: info.name,
            path: info.targetPath,
            sourcePath: droppedPath,
            source: "drag_drop",
            arguments: info.arguments,
            workingDirectory: info.workingDirectory,
          });
          continue;
        }
        const fileName = await platform.getFileName(droppedPath);
        const directory = await platform.isDirectory(droppedPath);
        candidates.push({
          name: shortcutNameFromTarget(droppedPath, fileName, directory),
          path: droppedPath,
          sourcePath: droppedPath,
          source: "drag_drop",
          arguments: null,
          workingDirectory: null,
        });
      } catch {
        failures += 1;
      }
    }
    await addCandidates(candidates, failures);
  }, [addCandidates]);

  const addFromPicker = useCallback(async () => {
    const stop = beginInteraction("add-shortcut");
    const path = await platform.pickPath();
    if (path) await candidatesFromPaths([path]);
    stop();
  }, [candidatesFromPaths]);

  useEffect(() => {
    if (!platform.isDesktop() || !container) return;
    let disposed = false;
    let unlisten: () => void = () => undefined;
    void getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "enter" || payload.type === "over") setExternalDragActive(true);
      else if (payload.type === "leave") setExternalDragActive(false);
      else {
        setExternalDragActive(false);
        void candidatesFromPaths(payload.paths);
      }
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; });
    return () => { disposed = true; unlisten(); };
  }, [candidatesFromPaths, container]);

  useEffect(() => {
    if (!container) return;
    const hasFiles = (transfer: DataTransfer) => transfer.files.length > 0
      || Array.from(transfer.items).some((item) => item.kind === "file");
    const hasTextType = (transfer: DataTransfer) => Array.from(transfer.types).some((type) => type === "text/uri-list" || type === "text/plain");
    const dragOver = (event: DragEvent) => {
      if (!event.dataTransfer || hasFiles(event.dataTransfer) || !hasTextType(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setExternalDragActive(true);
    };
    const dragLeave = (event: DragEvent) => {
      if (!event.relatedTarget) setExternalDragActive(false);
    };
    const drop = (event: DragEvent) => {
      const transfer = event.dataTransfer;
      if (!transfer || hasFiles(transfer) || !hasTextType(transfer)) return;
      const urls = parseDroppedUrls(transfer.getData("text/uri-list"), transfer.getData("text/plain"));
      if (!urls.length) {
        setExternalDragActive(false);
        return;
      }
      event.preventDefault();
      setExternalDragActive(false);
      void addCandidates(urls.map((url) => ({
        name: shortcutNameFromTarget(url, "", false),
        path: url,
        source: "drag_drop",
        arguments: null,
        workingDirectory: null,
        sourcePath: null,
      })));
    };
    window.addEventListener("dragover", dragOver);
    window.addEventListener("dragleave", dragLeave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", dragOver);
      window.removeEventListener("dragleave", dragLeave);
      window.removeEventListener("drop", drop);
    };
  }, [addCandidates, container]);

  const startDragging = (event: React.MouseEvent<HTMLElement>) => { if (event.button === 0 && !windowSettings?.locked && !(event.target as HTMLElement).closest("[data-window-control]")) void platform.startDragging(); };
  if (!data) return <main className="floating-shell floating-shell--loading"><span className="loading-mark"><i /><i /><i /></span></main>;
  if (!container) return <main className="floating-shell floating-shell--empty"><Archive size={28} strokeWidth={1.45} /><p>这个容器已被移入回收站。</p></main>;

  const commitName = () => {
    const name = draftName.trim();
    if (name && name !== container.name) void actions.renameContainer(container.id, name); else setDraftName(container.name);
    setEditingName(false);
  };
  const beginRename = () => { setDraftName(container.name); setEditingName(true); };
  const startShortcutDrag = (event: DragStartEvent) => setActiveShortcutId(String(event.active.id));
  const finishDrag = (event: DragEndEvent) => {
    setActiveShortcutId(null);
    if (!event.over || event.active.id === event.over.id) return;
    const stop = beginInteraction("drag-shortcut");
    void actions.moveShortcut(String(event.active.id), container.id, String(event.over.id)).finally(stop);
  };
  const toggleAllSources = async () => {
    const paths = container.shortcuts.map((shortcut) => shortcut.sourcePath ?? shortcut.path).filter((path) => !/^https?:\/\//i.test(path));
    if (!paths.length) { notify("没有可处理的本地源文件", "info"); return; }
    try {
      const count = allSourcesHidden ? await platform.showPaths(paths) : await platform.hidePaths(paths);
      setAllSourcesHidden(!allSourcesHidden);
      notify(allSourcesHidden ? `已恢复 ${count} 个源文件` : `已隐藏 ${count} 个源文件`, "success");
    } catch (error) {
      notify(`批量切换失败：${String(error)}`, "error");
    }
  };
  const renderShortcutTile = (shortcut: ShortcutItem) => <SortableTile key={shortcut.id} shortcut={shortcut} container={container} data={data} onLaunch={launchShortcut} onReveal={revealShortcut} onDelete={deleteShortcut} onToggleSource={toggleShortcutSource} onMove={moveShortcut} />;
  const addTile = <button className="shortcut-tile shortcut-tile--add" type="button" onClick={() => void addFromPicker()}><span className="shortcut-tile__icon"><Plus size={24} /></span><span className="shortcut-tile__name">添加</span></button>;
  const activeShortcut = activeShortcutId ? container.shortcuts.find((shortcut) => shortcut.id === activeShortcutId) : null;

  return (
    <main className={`floating-shell ${windowSettings?.collapsed ? "is-collapsed" : ""} ${windowSettings?.locked ? "is-locked" : ""}`} onMouseEnter={revealDock} onMouseLeave={scheduleDock} onPointerDown={() => { pointerActiveRef.current = true; clearDockTimer(); }} onPointerUp={() => { pointerActiveRef.current = false; }} onPointerCancel={() => { pointerActiveRef.current = false; }}>
      <header className="floating-titlebar" onMouseDown={startDragging}>
        <div className="floating-titlebar__name"><span aria-hidden="true" />
          {editingName ? <input autoFocus className="floating-titlebar__input" data-window-control="rename" value={draftName} maxLength={24} onChange={(event) => setDraftName(event.target.value)} onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onBlur={commitName} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") commitName(); if (event.key === "Escape") { setDraftName(container.name); setEditingName(false); } }} /> : <strong onDoubleClick={(event) => { event.stopPropagation(); beginRename(); }} title={container.hotkey ? `双击重命名 · 快捷键 ${container.hotkey}` : "双击重命名 · 鼠标穿透恢复 Ctrl+Shift+M"}>{container.name}</strong>}
          <em>{container.shortcuts.length}</em>
        </div>
        <div className="window-controls" onMouseDown={(event) => event.stopPropagation()}>
          <IconButton data-window-control="pin" label={container.pinned ? "取消置顶" : "置顶工作区"} onClick={() => { const pinned = !container.pinned; void actions.setContainerPinned(container.id, pinned); void platform.setContainerWindowPinned(container.id, pinned); }}>{container.pinned ? <Pin size={15} /> : <PinOff size={15} />}</IconButton>
          <IconButton data-window-control="lock" label={windowSettings?.locked ? "解锁位置和尺寸" : "锁定位置和尺寸"} onClick={() => patchWindow({ locked: !windowSettings?.locked })}>{windowSettings?.locked ? <Lock size={15} /> : <Unlock size={15} />}</IconButton>
          <label className="floating-opacity" data-window-control="opacity" title={`透明度 ${windowSettings?.opacity ?? 100}%`}><span>{windowSettings?.opacity ?? 100}%</span><input aria-label="工作区透明度" type="range" min="60" max="100" value={windowSettings?.opacity ?? 100} onChange={(event) => patchOpacity(Number(event.target.value))} /></label>
          <IconButton data-window-control="click-through" label={windowSettings?.clickThrough ? "鼠标穿透已开启，按 Ctrl+Shift+M 恢复" : "开启鼠标穿透"} onClick={() => patchWindow({ clickThrough: !windowSettings?.clickThrough })}><MousePointer2 size={15} /></IconButton>
          <IconButton data-window-control="collapse" label={windowSettings?.collapsed ? "展开工作区" : "折叠工作区"} onClick={() => patchWindow({ collapsed: !windowSettings?.collapsed })}>{windowSettings?.collapsed ? <Maximize2 size={15} /> : <Minimize2 size={15} />}</IconButton>
          <IconButton data-window-control="more" label="更多工作区选项" onClick={() => setMoreOpen((value) => !value)}><MoreHorizontal size={16} /></IconButton>
          <IconButton data-window-control="hide" label="隐藏容器" tone="danger" onClick={() => void platform.hideContainerWindow(activeContainerId)}><X size={16} /></IconButton>
        </div>
      </header>
      {!windowSettings?.collapsed && <section className={`floating-content floating-content--${windowSettings?.layout ?? "grid"}`} aria-label={`${container.name} 快捷方式`}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={startShortcutDrag} onDragCancel={() => setActiveShortcutId(null)} onDragEnd={finishDrag}>
          <SortableContext items={container.shortcuts.map((item) => item.id)} strategy={verticalListSortingStrategy}>
            {container.shortcuts.length > 50 ? <VirtualGrid items={container.shortcuts} className="floating-shortcut-grid--virtual" minimumColumnWidth={74} rowHeight={86} trailingItem={addTile} renderItem={renderShortcutTile} /> : <div className="floating-shortcut-grid">{container.shortcuts.map(renderShortcutTile)}{addTile}</div>}
          </SortableContext>
          <DragOverlay dropAnimation={null}>{activeShortcut && <div className="shortcut-drag-overlay"><GripVertical size={15} /><span>{activeShortcut.name}</span></div>}</DragOverlay>
        </DndContext>
        {!container.shortcuts.length && <p className="floating-empty">还没有快捷方式</p>}
      </section>}
      {!windowSettings?.collapsed && <footer className="floating-statusbar"><span>{saveState === "saving" ? "正在保存" : saveState === "error" ? "保存失败" : container.pinned ? "置顶工作区" : "普通窗口"}</span><span>{windowSettings?.clickThrough ? "鼠标穿透" : "拖动图标排序"}</span></footer>}
      {moreOpen && windowSettings && <aside className="floating-more" data-window-control="more" aria-label="工作区设置">
        <header><div><strong>工作区设置</strong><span>{container.name}</span></div><IconButton label="关闭工作区设置" onClick={() => setMoreOpen(false)}><X size={15} /></IconButton></header>
        <section className="floating-more__section"><h2>常用操作</h2><div className="floating-more__actions">
          <button type="button" onClick={() => { beginRename(); setMoreOpen(false); }}><Pencil size={15} /><span>重命名</span></button>
          <button type="button" onClick={() => void toggleAllSources()}>{allSourcesHidden ? <Eye size={15} /> : <EyeOff size={15} />}<span>{allSourcesHidden ? "显示源文件" : "隐藏源文件"}</span></button>
        </div></section>
        <section className="floating-more__section"><h2>窗口行为</h2>
          <label className="floating-setting-row"><strong>贴边自动隐藏</strong><span className="switch"><input type="checkbox" checked={windowSettings.autoHide} onChange={(event) => patchWindow({ autoHide: event.target.checked })} /><span /></span></label>
          <label className="floating-setting-row"><strong>不显示在任务栏</strong><span className="switch"><input type="checkbox" checked={windowSettings.skipTaskbar} onChange={(event) => patchWindow({ skipTaskbar: event.target.checked })} /><span /></span></label>
          <label className="floating-setting-row"><strong>所有虚拟桌面</strong><span className="switch"><input type="checkbox" checked={windowSettings.allWorkspaces} onChange={(event) => patchWindow({ allWorkspaces: event.target.checked })} /><span /></span></label>
          <label className="floating-setting-row floating-setting-row--select"><strong>吸附边缘</strong><select value={windowSettings.snapEdge} onChange={(event) => patchWindow({ snapEdge: event.target.value as ContainerWindowSettings["snapEdge"] })}><option value="none">关闭</option><option value="left">左侧</option><option value="right">右侧</option><option value="top">顶部</option><option value="bottom">底部</option></select></label>
        </section>
        <section className="floating-more__section"><h2>快捷方式布局</h2><div className="segmented" aria-label="快捷方式布局"><button type="button" className={windowSettings.layout === "compact" ? "is-active" : ""} onClick={() => patchWindow({ layout: "compact" })}>紧凑</button><button type="button" className={windowSettings.layout === "grid" ? "is-active" : ""} onClick={() => patchWindow({ layout: "grid" })}>网格</button><button type="button" className={windowSettings.layout === "list" ? "is-active" : ""} onClick={() => patchWindow({ layout: "list" })}>列表</button></div></section>
        <button className="floating-more__reset" type="button" onClick={() => patchWindow({ x: 140, y: 120, width: 420, height: 360, expandedHeight: 360 })}>重置位置与尺寸</button>
      </aside>}
      {windowSettings?.clickThrough && <div className="floating-through-notice"><MousePointer2 size={13} />鼠标穿透已开启</div>}
      {externalDragActive && <div className="floating-drop-overlay" aria-hidden="true"><Plus size={24} /><strong>释放以添加</strong></div>}
      <ToastStack toasts={toasts} />
    </main>
  );
}
