import { useEffect, useMemo, useState } from "react";
import { Archive } from "lucide-react";
import { useDeskBox } from "./hooks/useDeskBox";
import { AddContainerModal } from "./components/AddContainerModal";
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
import { searchDeskBox, type SearchResult } from "./data/search";
import { platform } from "./services/platform";
import { appWindowStore } from "./stores/useAppStore";

type DialogState =
  | { kind: "none" }
  | { kind: "add-container" }
  | { kind: "settings" }
  | { kind: "trash" }
  | { kind: "delete-container"; containerId: string; name: string };

export default function App() {
  const label = platform.currentWindowLabel();
  if (label === "quick-launch") return <QuickLauncher />;
  const containerId = platform.currentContainerId();
  return containerId ? <FloatingContainer containerId={containerId} /> : <DeskBoxHome />;
}

function DeskBoxHome() {
  const { data, actions, toasts, saveState, notify } = useDeskBox();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"overview" | "manage">("overview");

  useEffect(() => { if (data) document.documentElement.dataset.theme = data.settings.theme; }, [data?.settings.theme]);
  const searchResults = useMemo(() => data && query.trim() ? searchDeskBox(data, query, 40) : [], [data, query]);

  if (!data) return <main className="app-shell app-shell--loading"><span className="loading-mark"><i /><i /><i /></span><p>正在整理桌面盒子...</p></main>;

  const openContainer = async (containerId: string) => {
    await appWindowStore.showContainerWindow(containerId).catch((error) => notify(`无法打开悬浮工作区：${error instanceof Error ? error.message : String(error)}`, "error"));
  };
  const selectSearchResult = async (result: SearchResult) => {
    if (result.kind === "shortcut") await actions.launchShortcut(result.shortcut.id);
    else if (result.kind === "container") await openContainer(result.container.id);
    else await actions.launchPath(result.target);
  };
  const deleteContainer = async (containerId: string) => {
    await actions.deleteContainer(containerId);
    appWindowStore.forgetContainerWindow(containerId);
    await appWindowStore.hideContainerWindow(containerId);
  };
  const visibleContainers = data.containers.filter((container) => !container.hidden);
  const totalShortcuts = data.containers.reduce((sum, container) => sum + container.shortcuts.length, 0);

  return (
    <main className="app-shell">
      <TitleBar />
      <div className="workspace">
        <Toolbar query={query} view={view} visibleCount={visibleContainers.length} totalCount={totalShortcuts} trashCount={data.trash.length} onQueryChange={setQuery} onViewChange={setView} onAddContainer={() => setDialog({ kind: "add-container" })} onOpenSettings={() => setDialog({ kind: "settings" })} onOpenTrash={() => setDialog({ kind: "trash" })} onOpenQuickLaunch={() => void platform.showQuickLaunch()} />
        {query.trim() ? (
          <section className="home-search-results"><SearchResults results={searchResults} activeIndex={-1} onSelect={(result) => void selectSearchResult(result)} /></section>
        ) : view === "manage" ? (
          <ManageView data={data} onLaunch={(id) => void actions.launchShortcut(id)} onReveal={(path) => void actions.reveal(path)} onDelete={(containerId, id) => void actions.deleteShortcut(containerId, id)} onMove={(id, target, before) => void actions.moveShortcut(id, target, before)} onReorderContainer={(id, before) => void actions.reorderContainer(id, before)} />
        ) : (
          <section className="container-grid" aria-label="容器概览">
            {visibleContainers.map((container) => <ContainerCard key={container.id} container={container} onOpen={() => void openContainer(container.id)} onRename={(name) => void actions.renameContainer(container.id, name)} onHide={() => { void actions.setContainerHidden(container.id, true); void appWindowStore.hideContainerWindow(container.id); }} onDelete={() => setDialog({ kind: "delete-container", containerId: container.id, name: container.name })} />)}
            {!visibleContainers.length && <div className="empty-state"><span><Archive size={27} strokeWidth={1.45} /></span><h2>主页还没有可见容器</h2><p>新建容器后即可开始整理。</p><button className="button button--primary" type="button" onClick={() => setDialog({ kind: "add-container" })}>新建第一个容器</button></div>}
          </section>
        )}
      </div>
      <footer className="statusbar"><span className={`save-indicator save-indicator--${saveState}`}><i />{saveState === "saving" ? "正在保存" : saveState === "error" ? "保存失败" : "数据已同步"}</span><span>DeskBox 0.2.0</span></footer>
      {dialog.kind === "add-container" && <AddContainerModal onAdd={(name) => void actions.addContainer(name)} onClose={() => setDialog({ kind: "none" })} />}
      {dialog.kind === "settings" && <SettingsPanel data={data} onChange={(settings) => void actions.updateSettings(settings)} onRestoreContainer={(id) => void actions.setContainerHidden(id, false)} onExport={() => void actions.exportBackup()} onImport={() => void actions.importBackup()} onOpenBackupDirectory={() => void actions.openBackupDirectory()} onClose={() => setDialog({ kind: "none" })} />}
      {dialog.kind === "trash" && <TrashPanel data={data} onRestore={actions.restoreTrash} onPermanentDelete={actions.permanentDeleteTrash} onEmpty={actions.emptyTrash} onClose={() => setDialog({ kind: "none" })} />}
      {dialog.kind === "delete-container" && <ConfirmDialog title={`移除「${dialog.name}」？`} message="容器及其中的快捷方式会进入 DeskBox 回收站，不会删除电脑中的原始文件。" confirmText="移入回收站" onConfirm={() => void deleteContainer(dialog.containerId)} onClose={() => setDialog({ kind: "none" })} />}
      <ToastStack toasts={toasts} />
    </main>
  );
}
