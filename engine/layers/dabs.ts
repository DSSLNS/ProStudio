/**
 * Brush engine core: converts stroke input points into evenly spaced "dabs".
 * Pure and resolution independent (frame pixels in, frame pixels out).
 */
import type { BrushParams } from "@/types/layers";

export interface Dab {
  x: number;
  y: number;
  /** Diameter in frame px. */
  size: number;
  /** Per-dab coverage 0..1. */
  flow: number;
  pressure: number;
}

/** Size multiplier for a pen pressure value (mouse reports 0.5 when pressed; treated as full). */
export function pressureScale(pressure: number, enabled: boolean): number {
  if (!enabled) return 1;
  return 0.15 + 0.85 * Math.max(0, Math.min(1, pressure));
}

/**
 * Walks the stroke polyline and emits dabs every `spacing × size` px.
 * A single point produces one dab (a click).
 */
export function strokeDabs(points: number[], brush: BrushParams): Dab[] {
  const n = Math.floor(points.length / 3);
  if (n === 0) return [];
  const dabs: Dab[] = [];
  const at = (i: number) => ({ x: points[i * 3], y: points[i * 3 + 1], p: points[i * 3 + 2] });
  const make = (x: number, y: number, p: number): Dab => {
    const s = pressureScale(p, brush.pressureSize);
    return { x, y, size: Math.max(0.5, brush.size * s), flow: brush.flow, pressure: p };
  };
  let prev = at(0);
  dabs.push(make(prev.x, prev.y, prev.p));
  let carry = 0; // distance travelled since the last dab
  for (let i = 1; i < n; i++) {
    const cur = at(i);
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    let t = 0;
    for (;;) {
      const pressure = prev.p + (cur.p - prev.p) * t;
      const step = Math.max(0.5, brush.size * pressureScale(pressure, brush.pressureSize) * brush.spacing);
      const remaining = step - carry;
      if (t + remaining / len > 1 + 1e-9) {
        carry += len * (1 - t);
        break;
      }
      t += remaining / len;
      carry = 0;
      dabs.push(make(prev.x + dx * t, prev.y + dy * t, prev.p + (cur.p - prev.p) * t));
      if (dabs.length > 500_000) return dabs;
    }
    prev = cur;
  }
  return dabs;
}

/** Bounding box of a stroke including the brush radius (frame px). */
export function strokeBounds(points: number[], brush: BrushParams): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 2 < points.length; i += 3) {
    x0 = Math.min(x0, points[i]);
    y0 = Math.min(y0, points[i + 1]);
    x1 = Math.max(x1, points[i]);
    y1 = Math.max(y1, points[i + 1]);
  }
  const r = brush.size / 2 + 2;
  return { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r };
}

/**
 * Input smoothing ("lazy brush"): an exponential moving average on raw pointer
 * samples, which removes hand jitter without lag at stroke end (the final raw
 * point is always appended).
 */
export class StrokeSmoother {
  private last: { x: number; y: number; p: number } | null = null;
  constructor(private readonly amount: number) {}
  push(x: number, y: number, p: number): [number, number, number] {
    if (!this.last || this.amount <= 0) {
      this.last = { x, y, p };
      return [x, y, p];
    }
    const k = 1 - Math.min(0.95, this.amount);
    this.last = {
      x: this.last.x + (x - this.last.x) * k,
      y: this.last.y + (y - this.last.y) * k,
      p: this.last.p + (p - this.last.p) * k,
    };
    return [this.last.x, this.last.y, this.last.p];
  }
}
