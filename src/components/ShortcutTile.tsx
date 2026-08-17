import { useEffect, useState, type MouseEvent } from "react";
import { AppWindow, Folder } from "lucide-react";
import type { ContainerItem, ShortcutItem } from "../types";
import { platform } from "../services/platform";
import { ShortcutMenu } from "./ShortcutMenu";

interface ShortcutTileProps {
  shortcut: ShortcutItem;
  onLaunch: () => void;
  onReveal: () => void;
  onDelete: () => void;
  onToggleSource?: () => void;
  containers?: ContainerItem[];
  containerId?: string;
  onMove?: (containerId: string) => void;
}

export function ShortcutTile({ shortcut, onLaunch, onReveal, onDelete, onToggleSource = () => undefined, containers, containerId, onMove }: ShortcutTileProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [sourceHidden, setSourceHidden] = useState(false);
  const sourcePath = shortcut.sourcePath ?? shortcut.path;
  useEffect(() => { let active = true; if (!/^https?:\/\//i.test(sourcePath)) void platform.getPathHidden(sourcePath).then((hidden) => { if (active) setSourceHidden(hidden); }).catch(() => undefined); return () => { active = false; }; }, [sourcePath]);
  const isFolder = !/\.[a-z0-9]+$/i.test(shortcut.path);
  const FallbackIcon = isFolder ? Folder : AppWindow;
  const openMenu = (event: MouseEvent) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); };
  return (
    <>
      <button className="shortcut-tile" type="button" onClick={onLaunch} onContextMenu={openMenu} title={`${shortcut.name}\n${shortcut.path}`}>
        <span className="shortcut-tile__icon">{shortcut.icon ? <img src={shortcut.icon} alt="" draggable={false} /> : <FallbackIcon size={27} strokeWidth={1.4} />}</span>
        <span className="shortcut-tile__name">{shortcut.name}</span>
      </button>
      {menu && <ShortcutMenu x={menu.x} y={menu.y} onReveal={onReveal} onDelete={onDelete} sourceHidden={sourceHidden} onToggleSource={() => { onToggleSource(); setSourceHidden((hidden) => !hidden); }} containers={containers} currentContainerId={containerId} onMove={onMove} onClose={() => setMenu(null)} />}
    </>
  );
}
