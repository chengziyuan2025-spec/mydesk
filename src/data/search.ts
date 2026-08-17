import type { CalculationResult } from "./calculator";
import type { AppData, ContainerItem, EverythingSearchItem, ExternalLauncherEntry, ShortcutItem, SystemAppCatalogItem } from "../types";

type Section = "计算" | "收藏" | "最近使用" | "高频项目" | "DeskBox" | "系统应用" | "文件" | "直接打开";
interface BaseResult { id: string; title: string; subtitle: string; score: number; section: Section; favorite: boolean; aliases: string[]; launchCount: number; lastUsedAt: number | null }
export type SearchResult =
  | (BaseResult & { kind: "shortcut"; shortcut: ShortcutItem; container: ContainerItem })
  | (BaseResult & { kind: "container"; container: ContainerItem })
  | (BaseResult & { kind: "direct"; target: string })
  | (BaseResult & { kind: "systemApp"; item: SystemAppCatalogItem; entry: ExternalLauncherEntry | null; available: boolean })
  | (BaseResult & { kind: "externalFile"; item: EverythingSearchItem; entry: ExternalLauncherEntry | null; available: boolean })
  | (BaseResult & { kind: "calculation"; expression: string; value: string });

export interface ExternalSearchData { systemApps?: SystemAppCatalogItem[]; everything?: EverythingSearchItem[]; calculation?: CalculationResult | null; pinyinTokens?: (value: string) => string[] }
const normalize = (value: string) => value.trim().toLocaleLowerCase();
const normalizePath = (value: string) => value.replaceAll("/", "\\").toLocaleLowerCase();
const fuzzyScore = (haystack: string, needle: string) => {
  if (!needle) return 0;
  if (haystack === needle) return 1000;
  if (haystack.startsWith(needle)) return 800 - Math.min(haystack.length - needle.length, 100);
  const substring = haystack.indexOf(needle);
  if (substring >= 0) return 600 - Math.min(substring, 100);
  let cursor = 0; let gap = 0;
  for (const character of needle) { const found = haystack.indexOf(character, cursor); if (found < 0) return -1; gap += found - cursor; cursor = found + 1; }
  return 320 - Math.min(gap, 200);
};

function textScore(title: string, aliases: string[], extra: string[], needle: string, resolvePinyin?: (value: string) => string[]) {
  const aliasScore = aliases.reduce((best, alias) => Math.max(best, fuzzyScore(normalize(alias), needle) + (normalize(alias) === needle ? 350 : 120)), -1);
  return Math.max(aliasScore, ...[title, ...(resolvePinyin?.(title) ?? []), ...extra].map(normalize).map((value, index) => fuzzyScore(value, needle) - index * 25));
}
const usageScore = (favorite: boolean, count: number, last: number | null) => (favorite ? 180 : 0) + Math.min(count * 5, 100) + (last ? Math.max(0, 160 - (Date.now() - last) / 86_400_000) : 0);

export const directTarget = (query: string): string | null => {
  const value = query.trim();
  if (/^https?:\/\/[^\s]+$/i.test(value)) return value;
  if (/^(?:[a-z]:\\|\\\\)[^\r\n]+$/i.test(value)) return value;
  return null;
};

function emptySections(results: SearchResult[], limit: number) {
  const used = new Set<string>();
  const take = (section: Section, predicate: (item: SearchResult) => boolean, sorter: (a: SearchResult, b: SearchResult) => number, count: number) =>
    results.filter((item) => !used.has(item.id) && predicate(item)).sort(sorter).slice(0, count).map((item) => { used.add(item.id); return { ...item, section }; });
  return [
    ...take("收藏", (item) => item.favorite, (a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.title.localeCompare(b.title), 8),
    ...take("最近使用", (item) => item.lastUsedAt !== null, (a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0), 6),
    ...take("高频项目", (item) => item.launchCount > 0, (a, b) => b.launchCount - a.launchCount, 6),
  ].slice(0, limit);
}

export function searchDeskBox(data: AppData, query: string, limit = 30, external: ExternalSearchData = {}): SearchResult[] {
  const fileOnly = /^file\s*:/i.test(query);
  const cleaned = fileOnly ? query.replace(/^file\s*:/i, "").trim() : query.trim();
  const needle = normalize(cleaned);
  const results: SearchResult[] = [];
  const persisted = new Map(data.externalLauncherEntries.map((entry) => [entry.key, entry]));
  if (!fileOnly) {
    for (const container of data.containers) {
      const score = needle ? textScore(container.name, container.aliases, [], needle, external.pinyinTokens) : 0;
      if (!needle || score >= 0) results.push({ kind: "container", id: `container:${container.id}`, title: container.name, subtitle: `${container.shortcuts.length} 个快捷方式${container.hidden ? " · 已隐藏" : ""}`, score: score + usageScore(container.favorite, container.openCount, container.lastOpenedAt) - 20, section: "DeskBox", favorite: container.favorite, aliases: container.aliases, launchCount: container.openCount, lastUsedAt: container.lastOpenedAt, container });
      for (const shortcut of container.shortcuts) {
        const shortcutScore = needle ? textScore(shortcut.name, shortcut.aliases, [shortcut.path, container.name], needle, external.pinyinTokens) : 0;
        if (!needle || shortcutScore >= 0) results.push({ kind: "shortcut", id: `shortcut:${shortcut.id}`, title: shortcut.name, subtitle: `${container.name} · ${shortcut.path}`, score: shortcutScore + usageScore(shortcut.favorite, shortcut.launchCount, shortcut.lastLaunchedAt), section: "DeskBox", favorite: shortcut.favorite, aliases: shortcut.aliases, launchCount: shortcut.launchCount, lastUsedAt: shortcut.lastLaunchedAt, shortcut, container });
      }
    }
    for (const item of external.systemApps ?? []) {
      const entry = persisted.get(item.key) ?? null;
      const score = needle ? textScore(item.name, entry?.aliases ?? [], [item.target], needle, external.pinyinTokens) : 0;
      if (!needle || score >= 0) results.push({ kind: "systemApp", id: item.key, title: item.name, subtitle: item.sourcePath ? "开始菜单应用" : "已安装应用", score: score + usageScore(entry?.favorite ?? false, entry?.launchCount ?? 0, entry?.lastLaunchedAt ?? null) - 70, section: "系统应用", favorite: entry?.favorite ?? false, aliases: entry?.aliases ?? [], launchCount: entry?.launchCount ?? 0, lastUsedAt: entry?.lastLaunchedAt ?? null, item, entry, available: true });
    }
  }
  for (const item of external.everything ?? []) {
    const entry = persisted.get(item.key) ?? null;
    const score = needle ? textScore(item.name, entry?.aliases ?? [], [item.path], needle, external.pinyinTokens) : 0;
    if (!needle || score >= 0) results.push({ kind: "externalFile", id: item.key, title: item.name, subtitle: item.path, score: score + usageScore(entry?.favorite ?? false, entry?.launchCount ?? 0, entry?.lastLaunchedAt ?? null) - 140, section: "文件", favorite: entry?.favorite ?? false, aliases: entry?.aliases ?? [], launchCount: entry?.launchCount ?? 0, lastUsedAt: entry?.lastLaunchedAt ?? null, item, entry, available: true });
  }
  for (const entry of data.externalLauncherEntries.filter((item) => !results.some((result) => result.id === item.key))) {
    if (fileOnly && entry.kind === "systemApp") continue;
    const score = needle ? textScore(entry.name, entry.aliases, [entry.target], needle, external.pinyinTokens) : 0;
    if (needle && score < 0) continue;
    if (entry.kind === "systemApp") {
      const item: SystemAppCatalogItem = { key: entry.key, name: entry.name, targetType: entry.targetType, target: entry.target, sourcePath: entry.sourcePath, icon: entry.icon };
      const available = entry.targetType !== "shellApp";
      results.push({ kind: "systemApp", id: entry.key, title: entry.name, subtitle: available ? "已保存的系统应用" : "已保存的系统应用 · 当前不可用", score: score + usageScore(entry.favorite, entry.launchCount, entry.lastLaunchedAt) - 70, section: "系统应用", favorite: entry.favorite, aliases: entry.aliases, launchCount: entry.launchCount, lastUsedAt: entry.lastLaunchedAt, item, entry, available });
    } else {
      const item: EverythingSearchItem = { key: entry.key, name: entry.name, path: entry.target, isDirectory: entry.kind === "folder" };
      results.push({ kind: "externalFile", id: entry.key, title: entry.name, subtitle: entry.target, score: score + usageScore(entry.favorite, entry.launchCount, entry.lastLaunchedAt) - 140, section: "文件", favorite: entry.favorite, aliases: entry.aliases, launchCount: entry.launchCount, lastUsedAt: entry.lastLaunchedAt, item, entry, available: true });
    }
  }
  if (!needle) return emptySections(results, limit);
  const calculation = external.calculation;
  if (calculation && !fileOnly) results.push({ kind: "calculation", id: `calculation:${calculation.expression}`, title: calculation.value, subtitle: calculation.expression, score: 3000, section: "计算", favorite: false, aliases: [], launchCount: 0, lastUsedAt: null, ...calculation });
  const target = directTarget(cleaned);
  if (target && !fileOnly) results.push({ kind: "direct", id: `direct:${target}`, title: target, subtitle: target.startsWith("http") ? "在默认浏览器中打开" : "打开本地路径", score: 2500, target, section: "直接打开", favorite: false, aliases: [], launchCount: 0, lastUsedAt: null });
  const deskPaths = new Set(results.filter((item): item is Extract<SearchResult, { kind: "shortcut" }> => item.kind === "shortcut")
    .flatMap((item) => [item.shortcut.path, item.shortcut.sourcePath].filter((path): path is string => !!path).map(normalizePath)));
  const appPaths = new Set(results.filter((item): item is Extract<SearchResult, { kind: "systemApp" }> => item.kind === "systemApp")
    .flatMap((item) => [item.item.target, item.item.sourcePath].filter((path): path is string => item.item.targetType === "path" && !!path).map(normalizePath)));
  const sectionOrder: Record<Section, number> = { "计算": 0, "直接打开": 1, DeskBox: 2, "系统应用": 3, "文件": 4, "收藏": 5, "最近使用": 6, "高频项目": 7 };
  return results.filter((item) => {
    if (item.kind === "systemApp" && item.item.targetType === "path") return ![item.item.target, item.item.sourcePath].some((path) => path && deskPaths.has(normalizePath(path)));
    if (item.kind === "externalFile") { const path = normalizePath(item.item.path); return !deskPaths.has(path) && !appPaths.has(path); }
    return true;
  })
    .sort((a, b) => sectionOrder[a.section] - sectionOrder[b.section] || b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
