import { describe, expect, it } from "vitest";
import { normalizeShortcutTarget, parseDroppedUrls, shortcutNameFromTarget, uniqueShortcutCandidates, type ShortcutCandidate } from "./externalDrop";

const candidate = (path: string): ShortcutCandidate => ({
  name: path,
  path,
  source: "drag_drop",
  arguments: null,
  workingDirectory: null,
});

describe("external drop helpers", () => {
  it("parses only HTTP(S) URLs and ignores uri-list comments", () => {
    expect(parseDroppedUrls("# exported\nhttps://example.com/a\nfile:///C:/secret", "not a url\nhttp://openai.com"))
      .toEqual(["https://example.com/a", "http://openai.com"]);
  });

  it("applies folder, executable, file, and URL naming rules", () => {
    expect(shortcutNameFromTarget("C:\\Work\\Assets", "Assets", true)).toBe("Assets");
    expect(shortcutNameFromTarget("C:\\Tools\\paint.exe", "paint", false)).toBe("paint");
    expect(shortcutNameFromTarget("C:\\Docs\\notes.txt", "notes", false)).toBe("notes.txt");
    expect(shortcutNameFromTarget("https://Example.com/Docs?q=KeepCase", "", false)).toBe("https://Example.com/Docs?q=KeepCase");
  });

  it("deduplicates normalized paths and URLs against a container and the batch", () => {
    const result = uniqueShortcutCandidates([
      candidate("c:/Tools/App.exe"),
      candidate("C:\\Tools\\Other.exe"),
      candidate("c:\\tools\\other.exe"),
      candidate("HTTPS://EXAMPLE.COM/"),
    ], ["C:\\TOOLS\\APP.EXE", "https://example.com"]);
    expect(result.map((item) => item.path)).toEqual(["C:\\Tools\\Other.exe"]);
    expect(normalizeShortcutTarget("C:/Tools/App.exe")).toBe("c:\\tools\\app.exe");
    expect(normalizeShortcutTarget("HTTPS://EXAMPLE.COM/Docs?q=KeepCase")).toBe("https://example.com/Docs?q=KeepCase");
  });
});
