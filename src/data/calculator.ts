import { all, create, type MathNode } from "mathjs";

const math = create(all, { number: "number", predictable: true });
const operators = new Set(["+", "-", "*", "/", "%", "^", "to"]);
const units = new Set([
  "mm", "cm", "m", "km", "in", "inch", "ft", "yd", "mi", "mm2", "cm2", "m2", "km2", "sqin", "sqft", "acre", "hectare",
  "ml", "l", "liter", "m3", "cm3", "floz", "cup", "pt", "qt", "gal", "mg", "g", "kg", "oz", "lb", "tonne",
  "degC", "degF", "K", "ms", "s", "sec", "min", "h", "hour", "day", "week", "bit", "byte", "B", "KB", "MB", "GB", "TB", "KiB", "MiB", "GiB", "TiB",
]);
const looksLikeCalculation = (query: string) => /^\s*[-+]?\d/.test(query) && (/[-+*/%^()]|\s(?:to|in)\s/i.test(query) || /\d\s*[a-zA-Z]/.test(query));

function allowed(node: MathNode): boolean {
  let safe = true;
  node.traverse((child) => {
    if (child.type === "ConstantNode" || child.type === "ParenthesisNode") return;
    if (child.type === "OperatorNode") { if (!operators.has((child as unknown as { op: string }).op)) safe = false; return; }
    if (child.type === "SymbolNode") { if (!units.has((child as unknown as { name: string }).name)) safe = false; return; }
    safe = false;
  });
  return safe;
}

export interface CalculationResult { expression: string; value: string }
export function calculate(query: string): CalculationResult | null {
  const expression = query.trim().replace(/\s+in\s+/i, " to ");
  if (!looksLikeCalculation(expression) || expression.length > 160) return null;
  try {
    const node = math.parse(expression);
    if (!allowed(node)) return null;
    const value = math.format(node.compile().evaluate(), { precision: 12 });
    if (!value || /undefined|function|object/i.test(value)) return null;
    return { expression, value };
  } catch { return null; }
}
