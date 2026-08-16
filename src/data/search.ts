import type { AppData, ContainerItem, ShortcutItem } from "../types";

export type SearchResult =
  | { kind: "shortcut"; id: string; title: string; subtitle: string; score: number; shortcut: ShortcutItem; container: ContainerItem }
  | { kind: "container"; id: string; title: string; subtitle: string; score: number; container: ContainerItem }
  | { kind: "direct"; id: string; title: string; subtitle: string; score: number; target: string };

const normalize = (value: string) => value.trim().toLocaleLowerCase();

const fuzzyScore = (haystack: string, needle: string) => {
  if (!needle) return 0;
  if (haystack === needle) return 1000;
  if (haystack.startsWith(needle)) return 800 - Math.min(haystack.length - needle.length, 100);
  const substring = haystack.indexOf(needle);
  if (substring >= 0) return 600 - Math.min(substring, 100);
  let cursor = 0;
  let gap = 0;
  for (const character of needle) {
    const found = haystack.indexOf(character, cursor);
    if (found < 0) return -1;
    gap += found - cursor;
    cursor = found + 1;
  }
  return 320 - Math.min(gap, 200);
};

export const directTarget = (query: string): string | null => {
  const value = query.trim();
  if (/^https?:\/\/[^\s]+$/i.test(value)) return value;
  if (/^(?:[a-z]:\\|\\\\)[^\r\n]+$/i.test(value)) return value;
  return null;
};

export function searchDeskBox(data: AppData, query: string, limit = 30): SearchResult[] {
  const needle = normalize(query);
  const results: SearchResult[] = [];
  for (const container of data.containers.filter((item) => !item.hidden)) {
    if (needle) {
      const containerScore = fuzzyScore(normalize(container.name), needle);
      if (containerScore >= 0) {
        results.push({ kind: "container", id: `container:${container.id}`, title: container.name, subtitle: `${container.shortcuts.length} 个快捷方式`, score: containerScore - 30, container });
      }
    }
    for (const shortcut of container.shortcuts) {
      const recency = shortcut.lastLaunchedAt ? Math.max(0, 120 - (Date.now() - shortcut.lastLaunchedAt) / 86_400_000) : 0;
      const frequency = Math.min(shortcut.launchCount * 4, 80);
      const textScore = needle
        ? Math.max(
            fuzzyScore(normalize(shortcut.name), needle),
            fuzzyScore(normalize(shortcut.path), needle) - 80,
            fuzzyScore(normalize(container.name), needle) - 100,
          )
        : 0;
      if (!needle || textScore >= 0) {
        results.push({
          kind: "shortcut", id: `shortcut:${shortcut.id}`, title: shortcut.name,
          subtitle: `${container.name} · ${shortcut.path}`, score: textScore + recency + frequency,
          shortcut, container,
        });
      }
    }
  }
  const target = directTarget(query);
  if (target) results.unshift({ kind: "direct", id: `direct:${target}`, title: target, subtitle: target.startsWith("http") ? "在默认浏览器中打开" : "打开本地路径", score: 2000, target });
  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
