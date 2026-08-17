import { describe, expect, it } from "vitest";
import { calculate } from "./calculator";

describe("launcher calculator", () => {
  it("evaluates arithmetic and units", () => {
    expect(calculate("1 + 2 * 3")?.value).toBe("7");
    expect(calculate("25%")?.value).toBe("0.25");
    expect(calculate("10 cm to inch")?.value).toContain("inch");
    expect(calculate("32 degF to degC")?.value).toBe("0 degC");
  });
  it("rejects functions and assignments", () => {
    expect(calculate("import(1)")).toBeNull();
    expect(calculate("a = 2")).toBeNull();
  });
});
