import { useState, type MouseEvent } from "react";
import { AppWindow, Folder } from "lucide-react";
import type { ContainerItem, ShortcutItem } from "../types";
import { ShortcutMenu } from "./ShortcutMenu";

interface ShortcutTileProps {
  shortcut: ShortcutItem;
  onLaunch: () => void;
  onReveal: () => void;
  onDelete: () => void;
  containers?: ContainerItem[];
  containerId?: string;
  onMove?: (containerId: string) => void;
}

export function ShortcutTile({ shortcut, onLaunch, onReveal, onDelete, containers, containerId, onMove }: ShortcutTileProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const isFolder = !/\.[a-z0-9]+$/i.test(shortcut.path);
  const FallbackIcon = isFolder ? Folder : AppWindow;
  const openMenu = (event: MouseEvent) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); };
  return (
    <>
      <button className="shortcut-tile" type="button" onClick={onLaunch} onContextMenu={openMenu} title={`${shortcut.name}\n${shortcut.path}`}>
        <span className="shortcut-tile__icon">{shortcut.icon ? <img src={shortcut.icon} alt="" draggable={false} /> : <FallbackIcon size={27} strokeWidth={1.4} />}</span>
        <span className="shortcut-tile__name">{shortcut.name}</span>
      </button>
      {menu && <ShortcutMenu x={menu.x} y={menu.y} onReveal={onReveal} onDelete={onDelete} containers={containers} currentContainerId={containerId} onMove={onMove} onClose={() => setMenu(null)} />}
    </>
  );
}
