import { describe, expect, it } from "vitest";
import { createDefaultData } from "./defaults";
import { directTarget, searchDeskBox } from "./search";

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
});
