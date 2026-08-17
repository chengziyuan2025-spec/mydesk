import { pinyin } from "pinyin-pro";

const normalize = (value: string) => value.trim().toLocaleLowerCase();

export function pinyinTokens(value: string): string[] {
  if (!/[\u3400-\u9fff]/.test(value)) return [];
  return [
    pinyin(value, { toneType: "none", type: "array" }).join(""),
    pinyin(value, { pattern: "first", toneType: "none", type: "array" }).join(""),
  ].map(normalize);
}
