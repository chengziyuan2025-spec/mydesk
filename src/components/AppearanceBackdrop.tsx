import { useEffect, useState } from "react";
import type { Settings } from "../types";
import { platform } from "../services/platform";

function applyAppearance(settings: Settings, hasMedia: boolean) {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.appearance = hasMedia ? "custom" : "default";
  if (settings.appearance.accentColor) {
    root.style.setProperty("--accent", settings.appearance.accentColor);
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

  useEffect(() => { setFailed(false); }, [background.assetPath, background.kind]);
  useEffect(() => {
    applyAppearance(settings, Boolean(mediaUrl && background.kind !== "none" && !failed));
  }, [background.kind, failed, mediaUrl, settings]);

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
