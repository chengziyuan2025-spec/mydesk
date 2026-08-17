import { useEffect, useRef, useState } from "react";
import { EyeOff, ExternalLink, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import type { ContainerItem } from "../types";
import { IconButton } from "./IconButton";

interface ContainerCardProps {
  container: ContainerItem;
  onOpen: () => void;
  onRename: (name: string) => void;
  onHide: () => void;
  onDelete: () => void;
  onTogglePinned: () => void;
}

export function ContainerCard(props: ContainerCardProps) {
  const { container } = props;
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(container.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraftName(container.name);
    if (editing) inputRef.current?.select();
  }, [container.name, editing]);

  const commitName = () => {
    const name = draftName.trim();
    if (name && name !== container.name) props.onRename(name);
    else setDraftName(container.name);
    setEditing(false);
  };

  return (
    <article
      className="container-card container-card--overview"
      tabIndex={0}
      aria-label={`打开 ${container.name} 的悬浮工作区`}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen();
        }
      }}
    >
      <header className="container-card__header">
        <div className="container-card__title-wrap">
          <span className="container-card__indicator" aria-hidden="true" />
          {editing ? (
            <input
              ref={inputRef}
              className="container-card__title-input"
              value={draftName}
              maxLength={24}
              onChange={(event) => setDraftName(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onBlur={commitName}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") commitName();
                if (event.key === "Escape") { setDraftName(container.name); setEditing(false); }
              }}
            />
          ) : (
            <h2 onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => { event.stopPropagation(); setEditing(true); }} title="双击重命名">{container.name}</h2>
          )}
          <span className="container-card__count">{container.shortcuts.length}</span>
        </div>
        <div className="container-card__actions">
          <IconButton label={container.pinned ? "取消置顶" : "置顶容器"} onClick={(event) => { event.stopPropagation(); props.onTogglePinned(); }}>{container.pinned ? <Pin size={16} strokeWidth={1.7} /> : <PinOff size={16} strokeWidth={1.7} />}</IconButton>
          <IconButton label="重命名容器" onClick={(event) => { event.stopPropagation(); setDraftName(container.name); setEditing(true); }}><Pencil size={16} strokeWidth={1.7} /></IconButton>
          <IconButton label="隐藏容器" onClick={(event) => { event.stopPropagation(); props.onHide(); }}><EyeOff size={16} strokeWidth={1.7} /></IconButton>
          <IconButton label="删除容器" tone="danger" onClick={(event) => { event.stopPropagation(); props.onDelete(); }}><Trash2 size={16} strokeWidth={1.7} /></IconButton>
        </div>
      </header>
      <div className="container-card__summary">
        <span>独立悬浮工作区</span>
        <span>{container.shortcuts.length ? `包含 ${container.shortcuts.length} 个快捷方式` : "尚未添加快捷方式"}</span>
        <ExternalLink size={17} strokeWidth={1.65} aria-hidden="true" />
      </div>
    </article>
  );
}
