/** Pure chart maths so the SVG components stay thin and testable. */

export type Point = { x: number; y: number };

/** Linear resample to exactly `count` values, so two paths can morph point for point. */
export function resample(values: readonly number[], count: number): number[] {
  const clean = values.filter((value) => Number.isFinite(value));
  if (count <= 0) return [];
  if (clean.length === 0) return new Array<number>(count).fill(0);
  if (clean.length === 1) return new Array<number>(count).fill(clean[0] as number);
  const out: number[] = new Array<number>(count);
  for (let index = 0; index < count; index++) {
    const position = (index * (clean.length - 1)) / Math.max(1, count - 1);
    const low = Math.floor(position);
    const high = Math.min(clean.length - 1, low + 1);
    const t = position - low;
    out[index] = (clean[low] as number) * (1 - t) + (clean[high] as number) * t;
  }
  return out;
}

/** Min and max with headroom; a flat series gets a symmetric band so it draws mid-height. */
export function paddedExtent(values: readonly number[], pad = 0.08): [number, number] {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return [0, 1];
  let min = Math.min(...clean);
  let max = Math.max(...clean);
  if (max - min < 1e-9) {
    const band = Math.abs(max) * 0.01 || 1;
    return [min - band, max + band];
  }
  const span = max - min;
  min -= span * pad;
  max += span * pad;
  return [min, max];
}

export function project(
  values: readonly number[],
  box: { width: number; height: number; top?: number; bottom?: number },
  extent: [number, number],
): Point[] {
  const top = box.top ?? 0;
  const bottom = box.bottom ?? 0;
  const usable = Math.max(1, box.height - top - bottom);
  const [min, max] = extent;
  const span = max - min || 1;
  const step = values.length > 1 ? box.width / (values.length - 1) : 0;
  return values.map((value, index) => ({
    x: values.length > 1 ? index * step : box.width / 2,
    y: top + usable - ((value - min) / span) * usable,
  }));
}

const r = (value: number) => Math.round(value * 100) / 100;

/**
 * Monotone cubic (Fritsch–Carlson) path: smooth, never overshoots the data,
 * so a flat stretch stays flat and a peak is drawn at its true height.
 */
export function linePath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return "";
  const first = points[0] as Point;
  if (n === 1) return `M${r(first.x)},${r(first.y)}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    dx[i] = b.x - a.x;
    slope[i] = dx[i] === 0 ? 0 : (b.y - a.y) / (dx[i] as number);
  }
  const tangent: number[] = new Array<number>(n);
  tangent[0] = slope[0] as number;
  tangent[n - 1] = slope[n - 2] as number;
  for (let i = 1; i < n - 1; i++) {
    const s0 = slope[i - 1] as number;
    const s1 = slope[i] as number;
    tangent[i] = s0 * s1 <= 0 ? 0 : (3 * (dx[i - 1]! + dx[i]!)) / ((2 * dx[i]! + dx[i - 1]!) / s0 + (dx[i]! + 2 * dx[i - 1]!) / s1);
  }
  let d = `M${r(first.x)},${r(first.y)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    const h = (dx[i] as number) / 3;
    d += `C${r(a.x + h)},${r(a.y + h * (tangent[i] as number))},${r(b.x - h)},${r(b.y - h * (tangent[i + 1] as number))},${r(b.x)},${r(b.y)}`;
  }
  return d;
}

export function areaPath(points: readonly Point[], baseY: number): string {
  if (points.length < 2) return "";
  const first = points[0] as Point;
  const last = points[points.length - 1] as Point;
  return `${linePath(points)}L${r(last.x)},${r(baseY)}L${r(first.x)},${r(baseY)}Z`;
}

/** Index of the sample under an x position across `count` evenly spaced samples. */
export function indexAt(x: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, x / width));
  return Math.round(ratio * (count - 1));
}

/** Maps an index in a resampled series back to the nearest original point. */
export function originalIndex(sampleIndex: number, sampleCount: number, originalCount: number): number {
  if (originalCount <= 1 || sampleCount <= 1) return 0;
  return Math.round((sampleIndex * (originalCount - 1)) / (sampleCount - 1));
}

export function lerpArrays(from: readonly number[], to: readonly number[], t: number): number[] {
  return to.map((value, index) => {
    const start = from[index] ?? value;
    return start + (value - start) * t;
  });
}
