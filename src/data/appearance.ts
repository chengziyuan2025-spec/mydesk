import type { AppearanceSettings, BackgroundKind } from "../types";

const imageExtensions = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const videoExtensions = new Set(["mp4", "webm"]);

export function backgroundKindFromFileName(name: string): Exclude<BackgroundKind, "none"> | null {
  const extension = name.split(".").pop()?.toLocaleLowerCase();
  if (!extension) return null;
  if (imageExtensions.has(extension)) return "image";
  if (videoExtensions.has(extension)) return "video";
  return null;
}

export function normalizeAccentColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

export function clampBackgroundOverlay(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(80, Math.round(parsed))) : 34;
}

export function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const backgroundRaw = raw.background && typeof raw.background === "object" ? raw.background as Record<string, unknown> : {};
  const kind = backgroundRaw.kind === "image" || backgroundRaw.kind === "video" ? backgroundRaw.kind : "none";
  const assetPath = typeof backgroundRaw.assetPath === "string" && backgroundRaw.assetPath ? backgroundRaw.assetPath : null;
  const assetName = assetPath && typeof backgroundRaw.assetName === "string" && backgroundRaw.assetName ? backgroundRaw.assetName : null;
  const usableKind = assetPath && kind !== "none" ? kind : "none";
  return {
    accentColor: normalizeAccentColor(raw.accentColor),
    adaptiveAccent: raw.adaptiveAccent === true,
    background: { kind: usableKind, assetPath, assetName, overlay: clampBackgroundOverlay(backgroundRaw.overlay) },
  };
}
