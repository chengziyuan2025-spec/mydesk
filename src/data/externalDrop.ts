import type { ShortcutItem } from "../types";

export interface ShortcutCandidate {
  name: string;
  path: string;
  source: ShortcutItem["source"];
  arguments: string | null;
  workingDirectory: string | null;
}

export const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export const parseDroppedUrls = (...payloads: Array<string | null | undefined>): string[] => {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const payload of payloads) {
    for (const line of (payload ?? "").split(/\r?\n/)) {
      const value = line.trim();
      if (!value || value.startsWith("#") || !isHttpUrl(value)) continue;
      const key = normalizeShortcutTarget(value);
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push(value);
    }
  }
  return urls;
};

export const shortcutNameFromTarget = (
  path: string,
  fileName: string,
  directory: boolean,
): string => {
  if (/^https?:\/\//i.test(path)) {
    return path.trim();
  }
  const leaf = path.split(/[\\/]/).filter(Boolean).pop() ?? "";
  if (directory) return fileName || path;
  if (/\.(?:exe|lnk)$/i.test(leaf)) return leaf.replace(/\.(?:exe|lnk)$/i, "");
  return leaf || fileName || path;
};

export const normalizeShortcutTarget = (target: string): string => {
  const value = target.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      url.protocol = url.protocol.toLowerCase();
      url.hostname = url.hostname.toLowerCase();
      return url.toString();
    } catch { /* Fall through to path normalization. */ }
  }
  return value.replaceAll("/", "\\").replace(/\\+$/, "").toLocaleLowerCase();
};

export const uniqueShortcutCandidates = (
  candidates: ShortcutCandidate[],
  existingTargets: Iterable<string>,
): ShortcutCandidate[] => {
  const seen = new Set(Array.from(existingTargets, normalizeShortcutTarget));
  return candidates.filter((candidate) => {
    const key = normalizeShortcutTarget(candidate.path);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
