import { useEffect, useState } from "react";
import type { Settings } from "../types";
import { platform } from "../services/platform";

function applyAppearance(settings: Settings, hasMedia: boolean, adaptiveAccent: string | null) {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.appearance = hasMedia ? "custom" : "default";
  const accentColor = adaptiveAccent ?? settings.appearance.accentColor;
  if (accentColor) {
    root.style.setProperty("--accent", accentColor);
    root.style.setProperty("--accent-hover", "color-mix(in srgb, var(--accent) 84%, #000 16%)");
    root.style.setProperty("--accent-soft", "color-mix(in srgb, var(--accent) 16%, transparent)");
  } else {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-hover");
    root.style.removeProperty("--accent-soft");
  }
}

export function AppearanceBackdrop({ settings }: { settings: Settings }) {
  const background = settings.appearance.background;
  const mediaUrl = platform.backgroundUrl(background.assetPath);
  const [failed, setFailed] = useState(false);
  const [adaptiveAccent, setAdaptiveAccent] = useState<string | null>(null);

  useEffect(() => { setFailed(false); }, [background.assetPath, background.kind]);
  useEffect(() => {
    applyAppearance(settings, Boolean(mediaUrl && background.kind !== "none" && !failed), settings.appearance.adaptiveAccent ? adaptiveAccent : null);
  }, [adaptiveAccent, background.kind, failed, mediaUrl, settings]);

  useEffect(() => {
    if (!settings.appearance.adaptiveAccent) {
      setAdaptiveAccent(null);
      return;
    }
    let disposed = false;
    const refresh = () => {
      void platform.getWallpaperDominantColor().then((color) => {
        if (!disposed && color && /^#[0-9a-f]{6}$/i.test(color)) setAdaptiveAccent(color.toLowerCase());
      }).catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [settings.appearance.adaptiveAccent]);

  useEffect(() => () => {
    document.documentElement.dataset.appearance = "default";
    document.documentElement.style.removeProperty("--accent");
    document.documentElement.style.removeProperty("--accent-hover");
    document.documentElement.style.removeProperty("--accent-soft");
  }, []);

  const showMedia = Boolean(mediaUrl && background.kind !== "none" && !failed);
  return <div className="appearance-backdrop" aria-hidden="true">
    {showMedia && background.kind === "image" && <img className="appearance-backdrop__media" src={mediaUrl ?? undefined} alt="" onError={() => setFailed(true)} />}
    {showMedia && background.kind === "video" && <video className="appearance-backdrop__media" src={mediaUrl ?? undefined} autoPlay muted loop playsInline onError={() => setFailed(true)} />}
    {showMedia && <span className="appearance-backdrop__overlay" style={{ opacity: Math.max(0, Math.min(80, background.overlay)) / 100 }} />}
  </div>;
}
