import { describe, expect, it } from "vitest";
import { backgroundKindFromFileName, clampBackgroundOverlay, normalizeAccentColor, normalizeAppearanceSettings } from "./appearance";

describe("appearance helpers", () => {
  it("identifies supported desktop media", () => {
    expect(backgroundKindFromFileName("wallpaper.WEBP")).toBe("image");
    expect(backgroundKindFromFileName("ambient.mp4")).toBe("video");
    expect(backgroundKindFromFileName("document.pdf")).toBeNull();
  });

  it("validates accent colors and clamps overlay", () => {
    expect(normalizeAccentColor("#A1b2C3")).toBe("#a1b2c3");
    expect(normalizeAccentColor("red")).toBeNull();
    expect(clampBackgroundOverlay(-2)).toBe(0);
    expect(clampBackgroundOverlay(98)).toBe(80);
  });

  it("falls back cleanly when a media reference is incomplete", () => {
    expect(normalizeAppearanceSettings({ accentColor: "#336699", adaptiveAccent: true, background: { assetName: "movie.webm", overlay: "50" } })).toEqual({
      accentColor: "#336699",
      adaptiveAccent: true,
      background: { kind: "none", assetPath: null, assetName: null, overlay: 50 },
    });
  });

  it("defaults adaptive accent to disabled for existing v5 records", () => {
    expect(normalizeAppearanceSettings({ accentColor: "#336699" }).adaptiveAccent).toBe(false);
  });
});
