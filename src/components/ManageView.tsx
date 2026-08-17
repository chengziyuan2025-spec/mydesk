import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { AppData, ContainerItem, ShortcutItem } from "../types";
import { ShortcutTile } from "./ShortcutTile";
import { platform } from "../services/platform";

interface ManageViewProps {
  data: AppData;
  onLaunch: (shortcutId: string) => void;
  onReveal: (path: string) => void;
  onDelete: (containerId: string, shortcutId: string) => void;
  onMove: (shortcutId: string, targetContainerId: string, beforeShortcutId?: string | null) => void;
  onReorderContainer: (containerId: string, beforeContainerId: string | null) => void;
}

function SortableShortcut({ shortcut, container, data, props }: { shortcut: ShortcutItem; container: ContainerItem; data: AppData; props: ManageViewProps }) {
  const sortable = useSortable({ id: `shortcut:${shortcut.id}`, data: { type: "shortcut", shortcutId: shortcut.id, containerId: container.id } });
  return (
    <div ref={sortable.setNodeRef} data-container-id={container.id} className={`manage-shortcut ${sortable.isDragging ? "is-dragging" : ""}`} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}>
      <button type="button" className="shortcut-drag-handle" aria-label={`拖动 ${shortcut.name}`} title="拖动快捷方式" {...sortable.attributes} {...sortable.listeners}><GripVertical size={12} /></button>
      <ShortcutTile shortcut={shortcut} containers={data.containers} containerId={container.id} onMove={(item, target) => props.onMove(item.id, target)} onLaunch={(item) => props.onLaunch(item.id)} onReveal={(item) => props.onReveal(item.path)} onDelete={(item) => props.onDelete(container.id, item.id)} onToggleSource={(item) => void platform.togglePathHidden(item.sourcePath ?? item.path)} />
    </div>
  );
}

function SortableContainer({ container, data, props }: { container: ContainerItem; data: AppData; props: ManageViewProps }) {
  const sortable = useSortable({ id: `container:${container.id}`, data: { type: "container", containerId: container.id } });
  const drop = useDroppable({ id: `drop:${container.id}`, data: { type: "containerDrop", containerId: container.id } });
  return (
    <section ref={sortable.setNodeRef} data-container-id={container.id} className={`manage-container ${sortable.isDragging ? "is-dragging" : ""}`} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}>
      <header>
        <button type="button" className="manage-drag-handle" aria-label={`拖动 ${container.name}`} title="拖动排序" {...sortable.attributes} {...sortable.listeners}><GripVertical size={17} /></button>
        <strong>{container.name}</strong><span>{container.shortcuts.length}</span>
      </header>
      <SortableContext items={container.shortcuts.map((item) => `shortcut:${item.id}`)} strategy={verticalListSortingStrategy}>
        <div ref={drop.setNodeRef} className={`manage-shortcuts ${drop.isOver ? "is-drop-target" : ""}`}>
          {container.shortcuts.map((shortcut) => <SortableShortcut key={shortcut.id} shortcut={shortcut} container={container} data={data} props={props} />)}
          {!container.shortcuts.length && <div className="manage-container__empty">拖入快捷方式</div>}
        </div>
      </SortableContext>
    </section>
  );
}

export function ManageView(props: ManageViewProps) {
  const containers = props.data.containers.filter((item) => !item.hidden);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const finishDrag = (event: DragEndEvent) => {
    const active = event.active.data.current;
    const over = event.over?.data.current;
    if (!active || !event.over) return;
    if (active.type === "container") {
      const target = over?.containerId as string | undefined;
      if (target && target !== active.containerId) props.onReorderContainer(active.containerId, target);
      return;
    }
    const target = over?.containerId as string | undefined;
    if (!target) return;
    const overId = String(event.over.id);
    props.onMove(active.shortcutId, target, overId.startsWith("shortcut:") && overId !== String(event.active.id) ? overId.slice(9) : null);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={finishDrag}>
      <SortableContext items={containers.map((item) => `container:${item.id}`)} strategy={verticalListSortingStrategy}>
        <div className="manage-view">{containers.map((container) => <SortableContainer key={container.id} container={container} data={props.data} props={props} />)}</div>
      </SortableContext>
    </DndContext>
  );
}
