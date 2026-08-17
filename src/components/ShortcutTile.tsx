import { memo, useEffect, useRef, useState, type MouseEvent } from "react";
import { AppWindow, Folder } from "lucide-react";
import type { ContainerItem, ShortcutItem } from "../types";
import { platform } from "../services/platform";
import { ShortcutMenu } from "./ShortcutMenu";

const ICON_CACHE_LIMIT = 200;
const iconCache = new Map<string, string | null>();
const iconRequests = new Map<string, Promise<string | null>>();

function cacheIcon(path: string, icon: string | null) {
  iconCache.delete(path);
  iconCache.set(path, icon);
  if (iconCache.size > ICON_CACHE_LIMIT) iconCache.delete(iconCache.keys().next().value as string);
}

function loadIcon(path: string) {
  const cached = iconCache.get(path);
  if (cached !== undefined || iconCache.has(path)) return Promise.resolve(cached ?? null);
  const existing = iconRequests.get(path);
  if (existing) return existing;
  const request = platform.extractIcon(path)
    .catch(() => null)
    .then((icon) => {
      cacheIcon(path, icon);
      return icon;
    })
    .finally(() => iconRequests.delete(path));
  iconRequests.set(path, request);
  return request;
}

function LazyShortcutIcon({ shortcut, FallbackIcon }: { shortcut: ShortcutItem; FallbackIcon: typeof Folder }) {
  const nodeRef = useRef<HTMLSpanElement>(null);
  const [icon, setIcon] = useState<string | null>(() => shortcut.icon ?? iconCache.get(shortcut.path) ?? null);
  const [loading, setLoading] = useState(!shortcut.icon && !iconCache.has(shortcut.path));

  useEffect(() => {
    setIcon(shortcut.icon ?? iconCache.get(shortcut.path) ?? null);
    setLoading(!shortcut.icon && !iconCache.has(shortcut.path));
  }, [shortcut.icon, shortcut.path]);

  useEffect(() => {
    if (shortcut.icon || iconCache.has(shortcut.path) || !nodeRef.current) return;
    let disposed = false;
    const load = () => {
      void loadIcon(shortcut.path).then((value) => {
        if (!disposed) { setIcon(value); setLoading(false); }
      });
    };
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    }, { rootMargin: "160px" });
    observer.observe(nodeRef.current);
    return () => { disposed = true; observer.disconnect(); };
  }, [shortcut.icon, shortcut.path]);

  return <span ref={nodeRef} className={`shortcut-tile__icon ${loading ? "is-loading" : ""}`}>{icon ? <img src={icon} alt="" loading="lazy" draggable={false} /> : <FallbackIcon size={27} strokeWidth={1.4} />}</span>;
}

interface ShortcutTileProps {
  shortcut: ShortcutItem;
  onLaunch: (shortcut: ShortcutItem) => void;
  onReveal: (shortcut: ShortcutItem) => void;
  onDelete: (shortcut: ShortcutItem) => void;
  onToggleSource?: (shortcut: ShortcutItem) => void;
  containers?: ContainerItem[];
  containerId?: string;
  onMove?: (shortcut: ShortcutItem, containerId: string) => void;
}

export const ShortcutTile = memo(function ShortcutTile({ shortcut, onLaunch, onReveal, onDelete, onToggleSource = () => undefined, containers, containerId, onMove }: ShortcutTileProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [sourceHidden, setSourceHidden] = useState(false);
  const sourcePath = shortcut.sourcePath ?? shortcut.path;
  const isFolder = !/\.[a-z0-9]+$/i.test(shortcut.path);
  const FallbackIcon = isFolder ? Folder : AppWindow;
  const openMenu = (event: MouseEvent) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY });
    if (!/^https?:\/\//i.test(sourcePath)) void platform.getPathHidden(sourcePath).then(setSourceHidden).catch(() => undefined);
  };
  return (
    <>
      <button className="shortcut-tile" type="button" onClick={() => onLaunch(shortcut)} onContextMenu={openMenu} title={`${shortcut.name}\n${shortcut.path}`}>
        <LazyShortcutIcon shortcut={shortcut} FallbackIcon={FallbackIcon} />
        <span className="shortcut-tile__name">{shortcut.name}</span>
      </button>
      {menu && <ShortcutMenu x={menu.x} y={menu.y} onReveal={() => onReveal(shortcut)} onDelete={() => onDelete(shortcut)} sourceHidden={sourceHidden} onToggleSource={() => { onToggleSource(shortcut); setSourceHidden((hidden) => !hidden); }} containers={containers} currentContainerId={containerId} onMove={(target) => onMove?.(shortcut, target)} onClose={() => setMenu(null)} />}
    </>
  );
}, (previous, next) => previous.shortcut === next.shortcut && previous.containers === next.containers && previous.containerId === next.containerId);
