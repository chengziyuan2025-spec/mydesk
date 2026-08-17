import { describe, expect, it } from "vitest";
import { createDefaultData } from "./defaults";
import { directTarget, searchDeskBox } from "./search";
import { pinyinTokens } from "./pinyin";

describe("DeskBox search", () => {
  it("ranks exact shortcut names first", () => {
    const results = searchDeskBox(createDefaultData(), "计算器");
    expect(results[0].kind).toBe("shortcut");
    expect(results[0].title).toBe("计算器");
  });

  it("accepts only safe direct target forms", () => {
    expect(directTarget("https://example.com")).toBe("https://example.com");
    expect(directTarget("C:\\Tools\\app.exe")).toBe("C:\\Tools\\app.exe");
    expect(directTarget("powershell -Command whoami")).toBeNull();
    expect(directTarget("file:///C:/secret")).toBeNull();
  });

  it("matches standard pinyin initials and custom aliases", () => {
    const data = createDefaultData();
    expect(searchDeskBox(data, "jsq", 30, { pinyinTokens })[0].title).toBe("计算器");
    data.containers[0].shortcuts[0].aliases = ["jsb"];
    expect(searchDeskBox(data, "jsb")[0].title).toBe("计算器");
  });

  it("includes hidden containers by exact name", () => {
    const data = createDefaultData();
    data.containers[0].hidden = true;
    expect(searchDeskBox(data, "示例")[0].kind).toBe("container");
  });

  it("keeps aliased missing system apps searchable and marks them unavailable", () => {
    const data = createDefaultData();
    data.externalLauncherEntries.push({
      key: "system:missing", kind: "systemApp", name: "Old Editor", targetType: "shellApp", target: "Missing.App_123!App",
      sourcePath: null, icon: null, aliases: ["old"], favorite: true, launchCount: 2, lastLaunchedAt: 1,
    });
    const result = searchDeskBox(data, "old")[0];
    expect(result.kind).toBe("systemApp");
    expect(result.kind === "systemApp" && result.available).toBe(false);
  });

  it("prefers a DeskBox shortcut over the same Everything path", () => {
    const data = createDefaultData();
    const path = data.containers[0].shortcuts[0].path;
    const results = searchDeskBox(data, "calc", 30, { everything: [{ key: `file:${path.toLowerCase()}`, name: "calc.exe", path, isDirectory: false }] });
    expect(results.some((item) => item.kind === "shortcut")).toBe(true);
    expect(results.some((item) => item.kind === "externalFile")).toBe(false);
  });
});
