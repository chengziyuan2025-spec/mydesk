import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, FolderInput, FolderSearch, Trash2 } from "lucide-react";
import type { ContainerItem } from "../types";

interface ShortcutMenuProps {
  x: number;
  y: number;
  onReveal: () => void;
  onDelete: () => void;
  sourceHidden: boolean;
  onToggleSource: () => void;
  containers?: ContainerItem[];
  currentContainerId?: string;
  onMove?: (containerId: string) => void;
  onClose: () => void;
}

export function ShortcutMenu({ x, y, onReveal, onDelete, sourceHidden, onToggleSource, containers = [], currentContainerId, onMove, onClose }: ShortcutMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [targetQuery, setTargetQuery] = useState("");
  useEffect(() => {
    const close = () => onClose();
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", closeOnEscape); };
  }, [onClose]);

  const moveTargets = containers.filter((container) => container.id !== currentContainerId);
  const filteredTargets = moveTargets.filter((container) => container.name.toLocaleLowerCase().includes(targetQuery.trim().toLocaleLowerCase()));
  const left = Math.min(x, window.innerWidth - 218);
  const top = Math.max(6, Math.min(y, window.innerHeight - Math.min(320, 112 + moveTargets.length * 34)));
  return (
    <div ref={menuRef} className="context-menu" style={{ left, top }} onPointerDown={(event) => event.stopPropagation()} role="menu">
      <button type="button" role="menuitem" onClick={() => { onReveal(); onClose(); }}><FolderSearch size={17} strokeWidth={1.7} />在文件管理器中定位</button>
      <button type="button" role="menuitem" onClick={() => { onToggleSource(); onClose(); }}>{sourceHidden ? <Eye size={17} strokeWidth={1.7} /> : <EyeOff size={17} strokeWidth={1.7} />}{sourceHidden ? "恢复源文件显示" : "隐藏源文件"}</button>
      {onMove && moveTargets.length > 0 && <div className="context-menu__group">
        <span><FolderInput size={15} />移动到</span>
        {moveTargets.length > 6 && <input className="context-menu__filter" autoFocus value={targetQuery} onChange={(event) => setTargetQuery(event.target.value)} onPointerDown={(event) => event.stopPropagation()} placeholder="搜索工作区" aria-label="搜索目标工作区" />}
        {filteredTargets.map((container) => <button type="button" role="menuitem" key={container.id} onClick={() => { onMove(container.id); onClose(); }}>{container.name}</button>)}
        {!filteredTargets.length && <small className="context-menu__empty">没有匹配的工作区</small>}
      </div>}
      <button type="button" role="menuitem" className="context-menu__danger" onClick={() => { onDelete(); onClose(); }}><Trash2 size={17} strokeWidth={1.7} />移入回收站</button>
    </div>
  );
}
