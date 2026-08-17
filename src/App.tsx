import { useEffect, useMemo, useRef, useState } from "react";
import { Archive } from "lucide-react";
import { useDeskBox } from "./hooks/useDeskBox";
import { AddContainerModal } from "./components/AddContainerModal";
import { AppearanceBackdrop } from "./components/AppearanceBackdrop";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ContainerCard } from "./components/ContainerCard";
import { FloatingContainer } from "./components/FloatingContainer";
import { ManageView } from "./components/ManageView";
import { QuickLauncher } from "./components/QuickLauncher";
import { SearchResults } from "./components/SearchResults";
import { SettingsPanel } from "./components/SettingsPanel";
import { TitleBar } from "./components/TitleBar";
import { ToastStack } from "./components/ToastStack";
import { Toolbar } from "./components/Toolbar";
import { TrashPanel } from "./components/TrashPanel";
import { VirtualGrid } from "./components/VirtualGrid";
import { searchDeskBox, type SearchResult } from "./data/search";
import { beginInteraction } from "./data/performance";
import type { CalculationResult } from "./data/calculator";
import { platform } from "./services/platform";
import { appWindowStore } from "./stores/useAppStore";
import type { EverythingSearchItem, ExternalLauncherEntry, SystemAppCatalogItem } from "./types";

type DialogState =
  | { kind: "none" }
  | { kind: "add-container" }
  | { kind: "trash" }
  | { kind: "delete-container"; containerId: string; name: string };

const looksLikeExpression = (value: string) => /^\s*[-+]?\d/.test(value)
  && (/[-+*/%^()]|\s(?:to|in)\s/i.test(value) || /\d\s*[a-zA-Z]/.test(value));

export default function App() {
  const label = platform.currentWindowLabel();
  if (label === "quick-launch") return <QuickLauncher />;
  const containerId = platform.currentContainerId();
  return containerId ? <FloatingContainer containerId={containerId} /> : <DeskBoxHome initialPage={label === "settings" ? "settings" : "home"} />;
}

function DeskBoxHome({ initialPage = "home" }: { initialPage?: "home" | "settings" }) {
  const { data, actions, toasts, saveState, notify } = useDeskBox();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"overview" | "manage">("overview");
  const [systemApps, setSystemApps] = useState<SystemAppCatalogItem[]>([]);
  const [files, setFiles] = useState<EverythingSearchItem[]>([]);
  const [calculation, setCalculation] = useState<CalculationResult | null>(null);
  const [pinyinResolver, setPinyinResolver] = useState<((value: string) => string[]) | null>(null);
  const [restoreInteractionAvailable, setRestoreInteractionAvailable] = useState(false);
  const [page, setPage] = useState<"home" | "settings">(initialPage);
  const requestRef = useRef(0);

  useEffect(() => { void platform.getSystemAppCatalog().then(setSystemApps).catch(() => undefined); }, []);
  useEffect(() => {
    const refresh = () => void platform.hasContainerMouseInteractionBlocked().then(setRestoreInteractionAvailable).catch(() => undefined);
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    let disposed = false;
    let unlisten: () => void = () => undefined;
    void platform.onOpenSettings(() => setPage("settings")).then((stop) => { if (disposed) stop(); else unlisten = stop; });
    return () => { disposed = true; unlisten(); };
  }, []);
  useEffect(() => {
    if (!data?.settings.everything.enabled || !query.trim()) { setFiles([]); return; }
    const cleaned = query.replace(/^file\s*:/i, "").trim();
    if (cleaned.length < 2) { setFiles([]); return; }
    const request = ++requestRef.current;
    const timer = window.setTimeout(() => {
      void platform.searchEverything(cleaned, 30).then((items) => { if (request === requestRef.current) setFiles(items); }).catch(() => { if (request === requestRef.current) setFiles([]); });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [data?.settings.everything.enabled, query]);
  useEffect(() => {
    const expression = query.trim();
    if (!looksLikeExpression(expression)) {
      setCalculation(null);
      return;
    }
    let cancelled = false;
    void import("./data/calculator").then(({ calculate }) => {
      if (!cancelled) setCalculation(calculate(expression));
    });
    return () => { cancelled = true; };
  }, [query]);
  useEffect(() => {
    if (!query.trim() || pinyinResolver) return;
    let cancelled = false;
    void import("./data/pinyin").then(({ pinyinTokens }) => { if (!cancelled) setPinyinResolver(() => pinyinTokens); });
    return () => { cancelled = true; };
  }, [pinyinResolver, query]);
  const searchResults = useMemo(() => data && query.trim() ? searchDeskBox(data, query, 40, { systemApps, everything: files, calculation: looksLikeExpression(query) ? calculation : null, pinyinTokens: pinyinResolver ?? undefined }) : [], [calculation, data, files, pinyinResolver, query, systemApps]);

  if (!data) return <main className="app-shell app-shell--loading"><span className="loading-mark"><i /><i /><i /></span><p>正在整理桌面盒子...</p></main>;

  const openContainer = async (containerId: string) => {
    const stop = beginInteraction("open-container");
    try {
      await actions.recordContainerOpened(containerId);
      await appWindowStore.showContainerWindow(containerId);
    } catch (error) { notify(`无法打开悬浮工作区：${error instanceof Error ? error.message : String(error)}`, "error"); }
    finally { stop(); }
  };
  const selectSearchResult = async (result: SearchResult) => {
    if (result.kind === "shortcut") await actions.launchShortcut(result.shortcut.id);
    else if (result.kind === "container") await openContainer(result.container.id);
    else if (result.kind === "direct") await actions.launchPath(result.target);
    else if (result.kind === "calculation") await navigator.clipboard.writeText(result.value);
    else {
      if (!result.available) { notify("该外部项目当前不可用", "error"); return; }
      const systemItem = result.kind === "systemApp" ? result.item : null;
      const fileItem = result.kind === "externalFile" ? result.item : null;
      await platform.launchExternalItem(systemItem?.targetType ?? "path", systemItem?.target ?? fileItem?.path ?? "");
      const existing = result.entry;
      const entry: ExternalLauncherEntry = {
        key: result.id,
        kind: existing?.kind ?? (systemItem ? "systemApp" : fileItem?.isDirectory ? "folder" : "file"),
        name: result.title,
        targetType: existing?.targetType ?? systemItem?.targetType ?? "path",
        target: existing?.target ?? systemItem?.target ?? fileItem?.path ?? "",
        sourcePath: existing?.sourcePath ?? systemItem?.sourcePath ?? fileItem?.path ?? null,
        icon: existing?.icon ?? systemItem?.icon ?? null,
        aliases: existing?.aliases ?? [], favorite: existing?.favorite ?? false,
        launchCount: result.launchCount + 1, lastLaunchedAt: Date.now(),
      };
      await actions.upsertExternalLauncherEntry(entry);
    }
  };
  const deleteContainer = async (containerId: string) => {
    await actions.deleteContainer(containerId);
    appWindowStore.forgetContainerWindow(containerId);
    await appWindowStore.hideContainerWindow(containerId);
  };
  const visibleContainers = data.containers.filter((container) => !container.hidden);
  const totalShortcuts = data.containers.reduce((sum, container) => sum + container.shortcuts.length, 0);

  return (
    <main className={`app-shell ${page === "settings" ? "settings-app-shell" : ""}`}>
      <AppearanceBackdrop settings={data.settings} />
      <TitleBar />
      {page === "settings" ? <SettingsPanel data={data} onChange={actions.updateSettings} onRestoreContainer={(id) => void actions.setContainerHidden(id, false)} onExport={() => void actions.exportBackup()} onImport={() => void actions.importBackup()} onOpenBackupDirectory={() => void actions.openBackupDirectory()} onNotify={notify} onBack={() => setPage("home")} /> : <div className="workspace">
        <Toolbar query={query} view={view} visibleCount={visibleContainers.length} totalCount={totalShortcuts} trashCount={data.trash.length} onQueryChange={setQuery} onViewChange={setView} onAddContainer={() => setDialog({ kind: "add-container" })} onOpenSettings={() => setPage("settings")} onOpenTrash={() => setDialog({ kind: "trash" })} onOpenQuickLaunch={() => void platform.showQuickLaunch()} onToggleAll={() => void platform.toggleAllContainerWindows()} onRestoreInteraction={() => void platform.restoreContainerMouseInteraction().then(() => setRestoreInteractionAvailable(false))} restoreInteractionAvailable={restoreInteractionAvailable} />
        {query.trim() ? (
          <section className="home-search-results"><SearchResults results={searchResults} activeIndex={-1} onSelect={(result) => void selectSearchResult(result).catch((error) => notify(`无法打开：${String(error)}`, "error"))} /></section>
        ) : view === "manage" ? (
          <ManageView data={data} onLaunch={(id) => void actions.launchShortcut(id)} onReveal={(path) => void actions.reveal(path)} onDelete={(containerId, id) => void actions.deleteShortcut(containerId, id)} onMove={(id, target, before) => void actions.moveShortcut(id, target, before)} onReorderContainer={(id, before) => void actions.reorderContainer(id, before)} />
        ) : (
          <section className="container-grid" aria-label="容器概览">
            {visibleContainers.length > 20 ? <VirtualGrid items={visibleContainers} className="container-grid--virtual" minimumColumnWidth={420} rowHeight={132} renderItem={(container) => <ContainerCard key={container.id} container={container} onOpen={() => void openContainer(container.id)} onRename={(name) => void actions.renameContainer(container.id, name)} onTogglePinned={() => { const pinned = !container.pinned; void actions.setContainerPinned(container.id, pinned); void platform.setContainerWindowPinned(container.id, pinned); }} onHide={() => { void actions.setContainerHidden(container.id, true); void appWindowStore.hideContainerWindow(container.id); }} onDelete={() => setDialog({ kind: "delete-container", containerId: container.id, name: container.name })} />} /> : visibleContainers.map((container) => <ContainerCard key={container.id} container={container} onOpen={() => void openContainer(container.id)} onRename={(name) => void actions.renameContainer(container.id, name)} onTogglePinned={() => { const pinned = !container.pinned; void actions.setContainerPinned(container.id, pinned); void platform.setContainerWindowPinned(container.id, pinned); }} onHide={() => { void actions.setContainerHidden(container.id, true); void appWindowStore.hideContainerWindow(container.id); }} onDelete={() => setDialog({ kind: "delete-container", containerId: container.id, name: container.name })} />)}
            {!visibleContainers.length && <div className="empty-state"><span><Archive size={27} strokeWidth={1.45} /></span><h2>主页还没有可见容器</h2><p>新建容器后即可开始整理。</p><button className="button button--primary" type="button" onClick={() => setDialog({ kind: "add-container" })}>新建第一个容器</button></div>}
          </section>
        )}
      </div>}
      {page === "home" && <footer className="statusbar"><span className={`save-indicator save-indicator--${saveState}`}><i />{saveState === "saving" ? "正在保存" : saveState === "error" ? "保存失败" : "数据已同步"}</span><span className="statusbar__hotkeys"><kbd>{data.settings.hotkeys.mainWindow ?? "Ctrl+Shift+H"}</kbd><kbd>{data.settings.hotkeys.quickLaunch ?? "Alt+Space"}</kbd><kbd>{data.settings.hotkeys.toggleContainers ?? "Ctrl+Shift+D"}</kbd><kbd>{data.settings.hotkeys.settings ?? "Ctrl+Shift+Comma"}</kbd></span></footer>}
      {dialog.kind === "add-container" && <AddContainerModal onAdd={(name) => void actions.addContainer(name)} onClose={() => setDialog({ kind: "none" })} />}
      {dialog.kind === "trash" && <TrashPanel data={data} onRestore={actions.restoreTrash} onPermanentDelete={actions.permanentDeleteTrash} onEmpty={actions.emptyTrash} onClose={() => setDialog({ kind: "none" })} />}
      {dialog.kind === "delete-container" && <ConfirmDialog title={`移除「${dialog.name}」？`} message="容器及其中的快捷方式会进入 DeskBox 回收站，不会删除电脑中的原始文件。" confirmText="移入回收站" onConfirm={() => void deleteContainer(dialog.containerId)} onClose={() => setDialog({ kind: "none" })} />}
      <ToastStack toasts={toasts} />
    </main>
  );
}
