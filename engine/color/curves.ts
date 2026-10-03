import type { CurvePoint, Curves } from "@/types/edit";

export const CURVE_LUT_SIZE = 1024;

/**
 * Monotone cubic (Fritsch–Carlson) interpolation through curve control points.
 * Monotonicity prevents the overshoot/ringing a natural spline produces between
 * close points — important for tone curves.
 */
export function buildCurveEvaluator(points: CurvePoint[]): (x: number) => number {
  const pts = [...points].sort((a, b) => a.x - b.x).filter((p, i, arr) => i === 0 || p.x > arr[i - 1].x + 1e-6);
  const n = pts.length;
  if (n === 0) return (x) => x;
  if (n === 1) return () => pts[0].y;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    let hi = n - 1;
    while (hi - i > 1) {
      const mid = (i + hi) >> 1;
      if (xs[mid] <= x) i = mid;
      else hi = mid;
    }
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h * m[i + 1]
    );
  };
}

export function isIdentityCurve(points: CurvePoint[]): boolean {
  return points.length === 2 && points[0].x === 0 && points[0].y === 0 && points[1].x === 1 && points[1].y === 1;
}

/**
 * Bake all four curves into a single RGBA float table (rgb, r, g, b in channels 0..3),
 * CURVE_LUT_SIZE entries each, clamped to 0..1. Used both as a GPU texture and on CPU.
 */
export function buildCurveTable(curves: Curves): Float32Array {
  const out = new Float32Array(CURVE_LUT_SIZE * 4);
  const fns = (["rgb", "r", "g", "b"] as const).map((ch) => buildCurveEvaluator(curves[ch]));
  for (let i = 0; i < CURVE_LUT_SIZE; i++) {
    const x = i / (CURVE_LUT_SIZE - 1);
    for (let c = 0; c < 4; c++) out[i * 4 + c] = Math.max(0, Math.min(1, fns[c](x)));
  }
  return out;
}

export function sampleCurveTable(table: Float32Array, channel: 0 | 1 | 2 | 3, x: number): number {
  const f = Math.max(0, Math.min(1, x)) * (CURVE_LUT_SIZE - 1);
  const i = Math.floor(f);
  const j = Math.min(CURVE_LUT_SIZE - 1, i + 1);
  const t = f - i;
  return table[i * 4 + channel] * (1 - t) + table[j * 4 + channel] * t;
}
