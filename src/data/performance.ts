const samples = new Map<string, number[]>();

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? 0;
}

export function beginInteraction(name: string) {
  if (!import.meta.env.DEV) return () => undefined;
  const start = `${name}:start:${performance.now().toFixed(3)}`;
  performance.mark(start);
  return () => {
    const end = `${name}:end:${performance.now().toFixed(3)}`;
    performance.mark(end);
    performance.measure(name, start, end);
    const duration = performance.getEntriesByName(name).at(-1)?.duration ?? 0;
    const values = [...(samples.get(name) ?? []), duration].slice(-200);
    samples.set(name, values);
    const p50 = percentile(values, 0.5);
    const p95 = percentile(values, 0.95);
    window.dispatchEvent(new CustomEvent("deskbox:performance", { detail: { name, duration, p50, p95, samples: values.length } }));
    console.debug(`[deskbox:perf] ${name} ${duration.toFixed(1)}ms p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms n=${values.length}`);
  };
}
