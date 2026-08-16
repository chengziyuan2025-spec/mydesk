import { useEffect, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Archive, GripVertical, Minus, Pencil, Plus, X } from "lucide-react";
import { useDeskBox } from "../hooks/useDeskBox";
import type { AppData, ContainerItem, ShortcutItem } from "../types";
import { platform } from "../services/platform";
import { AddShortcutModal } from "./AddShortcutModal";
import { IconButton } from "./IconButton";
import { ShortcutTile } from "./ShortcutTile";
import { ToastStack } from "./ToastStack";

interface FloatingContainerProps { containerId: string }

function SortableTile({ shortcut, container, data, onLaunch, onReveal, onDelete, onMove }: {
  shortcut: ShortcutItem; container: ContainerItem; data: AppData;
  onLaunch: () => void; onReveal: () => void; onDelete: () => void; onMove: (target: string) => void;
}) {
  const sortable = useSortable({ id: shortcut.id });
  return <div ref={sortable.setNodeRef} className={`floating-sortable ${sortable.isDragging ? "is-dragging" : ""}`} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}>
    <button type="button" className="shortcut-drag-handle" aria-label={`拖动 ${shortcut.name}`} title="拖动快捷方式" {...sortable.attributes} {...sortable.listeners}><GripVertical size={12} /></button>
    <ShortcutTile shortcut={shortcut} containers={data.containers} containerId={container.id} onLaunch={onLaunch} onReveal={onReveal} onDelete={onDelete} onMove={onMove} />
  </div>;
}

export function FloatingContainer({ containerId }: FloatingContainerProps) {
  const { data, actions, saveState, toasts } = useDeskBox({ enableDesktopWatcher: false });
  const [addingShortcut, setAddingShortcut] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const activeContainerId = platform.currentContainerId() ?? containerId;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => { if (data) document.documentElement.dataset.theme = data.settings.theme; }, [data?.settings.theme]);
  const startDragging = (event: React.MouseEvent<HTMLElement>) => { if (event.button === 0 && !(event.target as HTMLElement).closest("[data-window-control]")) void platform.startDragging(); };
  if (!data) return <main className="floating-shell floating-shell--loading"><span className="loading-mark"><i /><i /><i /></span></main>;
  const container = data.containers.find((item) => item.id === activeContainerId);
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

  return (
    <main className="floating-shell">
      <header className="floating-titlebar" onMouseDown={startDragging}>
        <div className="floating-titlebar__name"><span aria-hidden="true" />
          {editingName ? <input autoFocus className="floating-titlebar__input" data-window-control="rename" value={draftName} maxLength={24} onChange={(event) => setDraftName(event.target.value)} onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onBlur={commitName} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Enter") commitName(); if (event.key === "Escape") { setDraftName(container.name); setEditingName(false); } }} /> : <strong onDoubleClick={(event) => { event.stopPropagation(); beginRename(); }} title="双击重命名">{container.name}</strong>}
          <em>{container.shortcuts.length}</em>
        </div>
        <div className="window-controls" onMouseDown={(event) => event.stopPropagation()}>
          <IconButton data-window-control="rename" label="重命名容器" onClick={beginRename}><Pencil size={15} /></IconButton>
          <IconButton data-window-control="minimize" label="最小化" onClick={() => void platform.minimize()}><Minus size={16} /></IconButton>
          <IconButton data-window-control="hide" label="隐藏容器" tone="danger" onClick={() => void platform.hide()}><X size={16} /></IconButton>
        </div>
      </header>
      <section className="floating-content" aria-label={`${container.name} 快捷方式`}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={finishDrag}>
          <SortableContext items={container.shortcuts.map((item) => item.id)} strategy={verticalListSortingStrategy}>
            <div className="floating-shortcut-grid">
              {container.shortcuts.map((shortcut) => <SortableTile key={shortcut.id} shortcut={shortcut} container={container} data={data} onLaunch={() => void actions.launchShortcut(shortcut.id)} onReveal={() => void actions.reveal(shortcut.path)} onDelete={() => void actions.deleteShortcut(container.id, shortcut.id)} onMove={(target) => void actions.moveShortcut(shortcut.id, target)} />)}
              <button className="shortcut-tile shortcut-tile--add" type="button" onClick={() => setAddingShortcut(true)}><span className="shortcut-tile__icon"><Plus size={24} /></span><span className="shortcut-tile__name">添加</span></button>
            </div>
          </SortableContext>
        </DndContext>
        {!container.shortcuts.length && <p className="floating-empty">还没有快捷方式</p>}
      </section>
      <footer className="floating-statusbar"><span>{saveState === "saving" ? "正在保存" : saveState === "error" ? "保存失败" : "置顶工作区"}</span><span>拖动图标排序</span></footer>
      {addingShortcut && <AddShortcutModal containerName={container.name} onAdd={(name, path) => actions.addShortcut(container.id, name, path)} onClose={() => setAddingShortcut(false)} />}
      <ToastStack toasts={toasts} />
    </main>
  );
}
