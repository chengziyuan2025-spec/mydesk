import { useCallback, useEffect, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Archive, Eye, EyeOff, GripVertical, Lock, Maximize2, Minimize2, Minus, MousePointer2, Pencil, Pin, PinOff, Plus, Settings2, Unlock, X } from "lucide-react";
import { normalizeShortcutTarget, parseDroppedUrls, shortcutNameFromTarget, uniqueShortcutCandidates, type ShortcutCandidate } from "../data/externalDrop";
import { useDeskBox } from "../hooks/useDeskBox";
import type { AppData, ContainerItem, ContainerWindowSettings, ShortcutItem } from "../types";
import { platform } from "../services/platform";
import { AddShortcutModal } from "./AddShortcutModal";
import { AppearanceBackdrop } from "./AppearanceBackdrop";
import { IconButton } from "./IconButton";
import { ShortcutTile } from "./ShortcutTile";
import { ToastStack } from "./ToastStack";

interface FloatingContainerProps {
  containerId: string;
  onBeforeAdd?: (candidate: ShortcutCandidate) => Promise<ShortcutCandidate | boolean | void>;
}

function SortableTile({ shortcut, container, data, onLaunch, onReveal, onDelete, onToggleSource, onMove }: {
  shortcut: ShortcutItem; container: ContainerItem; data: AppData;
  onLaunch: () => void; onReveal: () => void; onDelete: () => void; onToggleSource: () => void; onMove: (target: string) => void;
}) {
  const sortable = useSortable({ id: shortcut.id });
  return <div ref={sortable.setNodeRef} className={`floating-sortable ${sortable.isDragging ? "is-dragging" : ""}`} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}>
    <button type="button" className="shortcut-drag-handle" aria-label={`拖动 ${shortcut.name}`} title="拖动快捷方式" {...sortable.attributes} {...sortable.listeners}><GripVertical size={12} /></button>
    <ShortcutTile shortcut={shortcut} containers={data.containers} containerId={container.id} onLaunch={onLaunch} onReveal={onReveal} onDelete={onDelete} onToggleSource={onToggleSource} onMove={onMove} />
  </div>;
}

export function FloatingContainer({ containerId, onBeforeAdd }: FloatingContainerProps) {
  const { data, actions, saveState, toasts, notify } = useDeskBox({ enableDesktopWatcher: false });
  const [addingShortcut, setAddingShortcut] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [externalDragActive, setExternalDragActive] = useState(false);
  const [windowSettings, setWindowSettings] = useState<ContainerWindowSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoHidden, setAutoHidden] = useState(false);
  const [allSourcesHidden, setAllSourcesHidden] = useState(false);
  const activeContainerId = platform.currentContainerId() ?? containerId;
  const container = data?.containers.find((item) => item.id === activeContainerId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => { void platform.getContainerWindowSettings(activeContainerId).then(setWindowSettings).catch(() => undefined); }, [activeContainerId]);
  useEffect(() => {
    if (!container) return;
    const paths = container.shortcuts.map((shortcut) => shortcut.sourcePath ?? shortcut.path).filter((path) => !/^https?:\/\//i.test(path));
    if (!paths.length) { setAllSourcesHidden(false); return; }
    void Promise.all(paths.map((path) => platform.getPathHidden(path).catch(() => false))).then((states) => setAllSourcesHidden(states.every(Boolean)));
  }, [activeContainerId, container?.shortcuts.length]);
  const patchWindow = useCallback(async (patch: Partial<ContainerWindowSettings>) => {
    try {
      const current = await platform.getContainerWindowSettings(activeContainerId);
      const next = { ...current, ...patch };
      setWindowSettings(await platform.updateContainerWindowSettings(activeContainerId, next));
    } catch { notify("窗口设置保存失败", "error"); }
  }, [activeContainerId, notify]);

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
  const finishDrag = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    void actions.moveShortcut(String(event.active.id), container.id, String(event.over.id));
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

  return (
    <main className={`floating-shell ${windowSettings?.collapsed ? "is-collapsed" : ""} ${windowSettings?.locked ? "is-locked" : ""} ${autoHidden ? `is-auto-hidden is-auto-hidden--${windowSettings?.snapEdge}` : ""}`} onMouseEnter={() => autoHidden && setAutoHidden(false)} onMouseLeave={() => { if (windowSettings?.autoHide && windowSettings.snapEdge !== "none") window.setTimeout(() => setAutoHidden(true), 450); }}>
      <AppearanceBackdrop settings={data.settings} />
      <header className="floating-titlebar" onMouseDown={startDragging}>
        <div className="floating-titlebar__name"><span aria-hidden="true" />
          {editingName ? <input autoFocus className="floating-titlebar__input" data-window-control="rename" value={draftName} maxLength={24} onChange={(event) => setDraftName(event.target.value)} onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onBlur={commitName} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") commitName(); if (event.key === "Escape") { setDraftName(container.name); setEditingName(false); } }} /> : <strong onDoubleClick={(event) => { event.stopPropagation(); beginRename(); }} title="双击重命名">{container.name}</strong>}
          <em>{container.shortcuts.length}</em>
        </div>
        <div className="window-controls" onMouseDown={(event) => event.stopPropagation()}>
          <IconButton data-window-control="pin" label={container.pinned ? "取消置顶" : "置顶工作区"} onClick={() => { const pinned = !container.pinned; void actions.setContainerPinned(container.id, pinned); void platform.setContainerWindowPinned(container.id, pinned); }}>{container.pinned ? <Pin size={15} /> : <PinOff size={15} />}</IconButton>
          <IconButton data-window-control="collapse" label={windowSettings?.collapsed ? "展开工作区" : "折叠工作区"} onClick={() => patchWindow({ collapsed: !windowSettings?.collapsed })}>{windowSettings?.collapsed ? <Maximize2 size={15} /> : <Minimize2 size={15} />}</IconButton>
          <IconButton data-window-control="settings" label="工作区设置" onClick={() => setSettingsOpen((value) => !value)}><Settings2 size={15} /></IconButton>
          <IconButton data-window-control="toggle-sources" label={allSourcesHidden ? "恢复全部源文件显示" : "隐藏全部源文件"} onClick={() => void toggleAllSources()}>{allSourcesHidden ? <Eye size={15} /> : <EyeOff size={15} />}</IconButton>
          <IconButton data-window-control="rename" label="重命名容器" onClick={beginRename}><Pencil size={15} /></IconButton>
          <IconButton data-window-control="minimize" label="最小化" onClick={() => void platform.minimize()}><Minus size={16} /></IconButton>
          <IconButton data-window-control="hide" label="隐藏容器" tone="danger" onClick={() => void platform.hide()}><X size={16} /></IconButton>
        </div>
      </header>
      {!windowSettings?.collapsed && <section className={`floating-content floating-content--${windowSettings?.layout ?? "grid"}`} aria-label={`${container.name} 快捷方式`}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={finishDrag}>
          <SortableContext items={container.shortcuts.map((item) => item.id)} strategy={verticalListSortingStrategy}>
            <div className="floating-shortcut-grid">
              {container.shortcuts.map((shortcut) => <SortableTile key={shortcut.id} shortcut={shortcut} container={container} data={data} onLaunch={() => void actions.launchShortcut(shortcut.id)} onReveal={() => void actions.reveal(shortcut.path)} onDelete={() => void actions.deleteShortcut(container.id, shortcut.id)} onToggleSource={() => void platform.togglePathHidden(shortcut.sourcePath ?? shortcut.path).then((hidden) => notify(hidden ? "源文件已隐藏" : "源文件已恢复显示", "success")).catch((error) => notify(`切换源文件显示失败：${String(error)}`, "error"))} onMove={(target) => void actions.moveShortcut(shortcut.id, target)} />)}
              <button className="shortcut-tile shortcut-tile--add" type="button" onClick={() => setAddingShortcut(true)}><span className="shortcut-tile__icon"><Plus size={24} /></span><span className="shortcut-tile__name">添加</span></button>
            </div>
          </SortableContext>
        </DndContext>
        {!container.shortcuts.length && <p className="floating-empty">还没有快捷方式</p>}
      </section>}
      {!windowSettings?.collapsed && <footer className="floating-statusbar"><span>{saveState === "saving" ? "正在保存" : saveState === "error" ? "保存失败" : container.pinned ? "置顶工作区" : "普通窗口"}</span><span>{windowSettings?.clickThrough ? "鼠标穿透" : "拖动图标排序"}</span></footer>}
      {settingsOpen && windowSettings && <aside className="floating-settings" data-window-control="settings">
        <header><strong>工作区设置</strong><button type="button" onClick={() => setSettingsOpen(false)}><X size={15} /></button></header>
        <label><span>置顶</span><input type="checkbox" checked={container.pinned} onChange={(e) => { void actions.setContainerPinned(container.id, e.target.checked); void platform.setContainerWindowPinned(container.id, e.target.checked); }} /></label>
        <label><span>锁定位置和尺寸</span><input type="checkbox" checked={windowSettings.locked} onChange={(e) => patchWindow({ locked: e.target.checked })} /></label>
        <label className="floating-settings__range"><span>透明度 {windowSettings.opacity}%</span><input type="range" min="60" max="100" value={windowSettings.opacity} onChange={(e) => void patchWindow({ opacity: Number(e.target.value) })} /></label>
        <label title="可在主界面恢复，或按 Ctrl+Shift+M"><span>鼠标穿透</span><input type="checkbox" checked={windowSettings.clickThrough} onChange={(e) => void patchWindow({ clickThrough: e.target.checked })} /></label>
        <label><span>贴边自动隐藏</span><input type="checkbox" checked={windowSettings.autoHide} onChange={(e) => patchWindow({ autoHide: e.target.checked })} /></label>
        <label><span>吸附边缘</span><select value={windowSettings.snapEdge} onChange={(e) => patchWindow({ snapEdge: e.target.value as ContainerWindowSettings["snapEdge"] })}><option value="none">关闭</option><option value="left">左侧</option><option value="right">右侧</option><option value="top">顶部</option><option value="bottom">底部</option></select></label>
        <label><span>不出现在任务栏</span><input type="checkbox" checked={windowSettings.skipTaskbar} onChange={(e) => patchWindow({ skipTaskbar: e.target.checked })} /></label>
        <label><span>显示在所有虚拟桌面</span><input type="checkbox" checked={windowSettings.allWorkspaces} onChange={(e) => patchWindow({ allWorkspaces: e.target.checked })} /></label>
        <div className="segmented" aria-label="快捷方式布局"><button type="button" className={windowSettings.layout === "compact" ? "is-active" : ""} onClick={() => patchWindow({ layout: "compact" })}>紧凑</button><button type="button" className={windowSettings.layout === "grid" ? "is-active" : ""} onClick={() => patchWindow({ layout: "grid" })}>网格</button><button type="button" className={windowSettings.layout === "list" ? "is-active" : ""} onClick={() => patchWindow({ layout: "list" })}>列表</button></div>
        <div className="floating-settings__dimensions"><label>X<input type="number" value={windowSettings.x} onChange={(e) => patchWindow({ x: Number(e.target.value) })} /></label><label>Y<input type="number" value={windowSettings.y} onChange={(e) => patchWindow({ y: Number(e.target.value) })} /></label><label>宽<input type="number" min="280" value={windowSettings.width} onChange={(e) => patchWindow({ width: Number(e.target.value) })} /></label><label>高<input type="number" min="220" value={windowSettings.height} onChange={(e) => patchWindow({ height: Number(e.target.value), expandedHeight: Number(e.target.value) })} /></label></div>
      </aside>}
      {windowSettings?.clickThrough && <div className="floating-through-notice"><MousePointer2 size={13} />鼠标穿透已开启</div>}
      {externalDragActive && <div className="floating-drop-overlay" aria-hidden="true"><Plus size={24} /><strong>释放以添加</strong></div>}
      {addingShortcut && <AddShortcutModal containerName={container.name} onAdd={(name, path, hideSource) => actions.addShortcut(container.id, name, path, { hideSource, sourcePath: path })} onClose={() => setAddingShortcut(false)} />}
      <ToastStack toasts={toasts} />
    </main>
  );
}
