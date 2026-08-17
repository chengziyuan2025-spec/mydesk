import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { searchDeskBox, type SearchResult } from "../data/search";
import type { CalculationResult } from "../data/calculator";
import { useDeskBox } from "../hooks/useDeskBox";
import { platform } from "../services/platform";
import { appWindowStore } from "../stores/useAppStore";
import type { EverythingSearchItem, ExternalLauncherEntry, SystemAppCatalogItem } from "../types";
import { AliasEditor } from "./AliasEditor";
import { AppearanceBackdrop } from "./AppearanceBackdrop";
import { SearchResults, type SearchAction } from "./SearchResults";
import { ToastStack } from "./ToastStack";

export function QuickLauncher() {
  const { data, actions, notify, toasts } = useDeskBox({ enableDesktopWatcher: false });
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [systemApps, setSystemApps] = useState<SystemAppCatalogItem[]>([]);
  const [files, setFiles] = useState<EverythingSearchItem[]>([]);
  const [calculation, setCalculation] = useState<CalculationResult | null>(null);
  const [pinyinResolver, setPinyinResolver] = useState<((value: string) => string[]) | null>(null);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  const [editingAliases, setEditingAliases] = useState<SearchResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const looksLikeExpression = /^\s*[-+]?\d/.test(query) && (/[-+*/%^()]|\s(?:to|in)\s/i.test(query) || /\d\s*[a-zA-Z]/.test(query));
  const results = useMemo(() => data ? searchDeskBox(data, query, 60, { systemApps, everything: files, calculation: looksLikeExpression ? calculation : null, pinyinTokens: pinyinResolver ?? undefined }) : [], [calculation, data, files, looksLikeExpression, pinyinResolver, query, systemApps]);

  useEffect(() => { setActiveIndex(0); }, [query, systemApps, files, calculation]);
  useEffect(() => {
    if (!looksLikeExpression) { setCalculation(null); return; }
    let cancelled = false;
    void import("../data/calculator").then(({ calculate }) => {
      if (!cancelled) setCalculation(calculate(query.trim()));
    });
    return () => { cancelled = true; };
  }, [looksLikeExpression, query]);
  useEffect(() => {
    if (!query.trim() || pinyinResolver) return;
    let cancelled = false;
    void import("../data/pinyin").then(({ pinyinTokens }) => { if (!cancelled) setPinyinResolver(() => pinyinTokens); });
    return () => { cancelled = true; };
  }, [pinyinResolver, query]);
  useEffect(() => { void platform.getSystemAppCatalog().then(setSystemApps).catch((error) => setSearchStatus(`应用目录不可用：${String(error)}`)); }, []);
  useEffect(() => {
    if (!data?.settings.everything.enabled) { setFiles([]); return; }
    const cleaned = query.replace(/^file\s*:/i, "").trim();
    if (cleaned.length < 2) { setFiles([]); return; }
    const request = ++requestRef.current;
    const timer = window.setTimeout(() => {
      void platform.searchEverything(cleaned, /^file\s*:/i.test(query) ? 60 : 30).then((items) => {
        if (request === requestRef.current) { setFiles(items); setSearchStatus(null); }
      }).catch((error) => { if (request === requestRef.current) { setFiles([]); setSearchStatus(`Everything：${String(error)}`); } });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [data?.settings.everything.enabled, query]);
  useEffect(() => {
    let unlisten: () => void = () => undefined;
    void platform.onQuickLaunchReset(() => { setQuery(""); setFiles([]); setActiveIndex(0); window.setTimeout(() => inputRef.current?.focus(), 20); }).then((stop) => { unlisten = stop; });
    inputRef.current?.focus(); return () => unlisten();
  }, []);

  const externalEntry = (result: Extract<SearchResult, { kind: "systemApp" | "externalFile" }>, patch: Partial<ExternalLauncherEntry> = {}): ExternalLauncherEntry => {
    const systemItem = result.kind === "systemApp" ? result.item : null;
    const fileItem = result.kind === "externalFile" ? result.item : null;
    const base: ExternalLauncherEntry = result.entry ?? {
      key: result.id, kind: systemItem ? "systemApp" : fileItem?.isDirectory ? "folder" : "file",
      name: result.title, targetType: systemItem?.targetType ?? "path", target: systemItem?.target ?? fileItem?.path ?? "",
      sourcePath: systemItem?.sourcePath ?? fileItem?.path ?? null, icon: systemItem?.icon ?? null,
      aliases: [], favorite: false, launchCount: 0, lastLaunchedAt: null,
    };
    return { ...base, ...patch };
  };

  const select = async (result: SearchResult) => {
    if (result.kind === "calculation") {
      await navigator.clipboard.writeText(result.value).then(() => notify("计算结果已复制", "success")).catch(() => notify("无法写入剪贴板", "error"));
      return;
    }
    if (result.kind === "shortcut") await actions.launchShortcut(result.shortcut.id);
    else if (result.kind === "container") { await actions.recordContainerOpened(result.container.id); await appWindowStore.showContainerWindow(result.container.id); }
    else if (result.kind === "direct") await actions.launchPath(result.target);
    else {
      if (!result.available) throw new Error("该外部项目当前不可用");
      const targetType = result.kind === "systemApp" ? result.item.targetType : "path";
      const target = result.kind === "systemApp" ? result.item.target : result.item.path;
      await platform.launchExternalItem(targetType, target).catch((error) => { throw new Error(String(error)); });
      await actions.upsertExternalLauncherEntry(externalEntry(result, { launchCount: result.launchCount + 1, lastLaunchedAt: Date.now() }));
    }
    await platform.hide();
  };

  const action = async (result: SearchResult, kind: SearchAction) => {
    if (kind === "aliases") { setEditingAliases(result); return; }
    if (kind === "favorite") {
      if (result.kind === "shortcut") await actions.setShortcutLauncherMeta(result.shortcut.id, result.aliases, !result.favorite);
      else if (result.kind === "container") await actions.setContainerLauncherMeta(result.container.id, result.aliases, !result.favorite);
      else if (result.kind === "systemApp" || result.kind === "externalFile") {
        const favorite = !result.favorite;
        if (!result.available && !favorite && result.aliases.length === 0) await actions.removeExternalLauncherEntry(result.id);
        else await actions.upsertExternalLauncherEntry(externalEntry(result, { favorite }));
      }
      return;
    }
    if (kind === "reveal") {
      const path = result.kind === "shortcut" ? result.shortcut.path : result.kind === "systemApp" ? result.item.sourcePath : result.kind === "externalFile" ? result.item.path : null;
      if (path) await actions.reveal(path);
      return;
    }
    if (kind === "delete" && result.kind === "shortcut") await actions.deleteShortcut(result.container.id, result.shortcut.id);
  };

  const saveAliases = async (result: SearchResult, aliases: string[]) => {
    if (result.kind === "shortcut") await actions.setShortcutLauncherMeta(result.shortcut.id, aliases, result.favorite);
    else if (result.kind === "container") await actions.setContainerLauncherMeta(result.container.id, aliases, result.favorite);
    else if (result.kind === "systemApp" || result.kind === "externalFile") {
      if (!result.available && aliases.length === 0 && !result.favorite) await actions.removeExternalLauncherEntry(result.id);
      else await actions.upsertExternalLauncherEntry(externalEntry(result, { aliases }));
    }
  };

  const place = async (result: SearchResult, containerId: string) => {
    if ((result.kind === "systemApp" || result.kind === "externalFile") && !result.available) throw new Error("该外部项目当前不可用");
    if (result.kind === "shortcut") await actions.moveShortcut(result.shortcut.id, containerId);
    else if (result.kind === "systemApp") await actions.addShortcut(containerId, result.title, result.item.target, { targetType: result.item.targetType, sourcePath: result.item.sourcePath });
    else if (result.kind === "externalFile") await actions.addShortcut(containerId, result.title, result.item.path, { targetType: "path", sourcePath: result.item.path });
  };

  return <main className="quick-launcher">
    {data && <AppearanceBackdrop settings={data.settings} />}
    <div className="quick-search"><Search size={22} strokeWidth={1.65} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索应用、容器、文件或输入算式" onKeyDown={(event) => {
      if (event.key === "Escape") void platform.hide();
      if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((value) => Math.min(value + 1, results.length - 1)); }
      if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((value) => Math.max(value - 1, 0)); }
      if (event.key === "Enter" && results[activeIndex]) { event.preventDefault(); if (event.ctrlKey && results[activeIndex].kind === "shortcut") void actions.reveal(results[activeIndex].shortcut.path); else void select(results[activeIndex]).catch((error) => notify(`无法打开：${String(error)}`, "error")); }
    }} /><button type="button" aria-label="关闭" title="关闭" onClick={() => void platform.hide()}><X size={18} /></button></div>
    <SearchResults results={results} activeIndex={activeIndex} onHover={setActiveIndex} onSelect={(result) => void select(result).catch((error) => notify(`无法打开：${String(error)}`, "error"))} compact containers={data?.containers ?? []} onAction={(result, kind) => void action(result, kind)} onMove={(result, containerId) => void place(result, containerId)} />
    <footer><span>{searchStatus ?? (data?.settings.everything.enabled ? "DeskBox + 应用 + Everything" : "DeskBox + 已安装应用")}</span><span>Alt + Space</span></footer>
    {editingAliases && <AliasEditor title={editingAliases.title} initial={editingAliases.aliases} onSave={(aliases) => void saveAliases(editingAliases, aliases)} onClose={() => setEditingAliases(null)} />}
    <ToastStack toasts={toasts} />
  </main>;
}
