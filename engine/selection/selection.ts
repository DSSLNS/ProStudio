/**
 * Selection engine. A selection is a MaskDoc with base 0 (nothing selected)
 * whose ops add/subtract/intersect shapes in frame px — compact, resolution
 * independent and directly usable as a layer mask or brush clip.
 * Pixel-derived selections (magic wand, colour range, AI subject) are stored
 * as a single raster op referencing a small greyscale asset.
 */
import type { CombineMode, MaskDoc, MaskOp } from "@/types/layers";

export type SelectionMode = Exclude<CombineMode, "replace"> | "new";

/** Combine a new selection shape with the current selection. */
export function combineSelection(current: MaskDoc | null, op: MaskOp, mode: SelectionMode): MaskDoc | null {
  const withMode = (m: CombineMode): MaskOp => ("mode" in op ? ({ ...op, mode: m } as MaskOp) : op);
  if (mode === "new" || !current) {
    if (mode === "subtract" || mode === "intersect") return current ? { ...current } : null;
    return { base: 0, ops: [withMode("add")] };
  }
  return { ...current, ops: [...current.ops, withMode(mode)] };
}

export const selectAll = (): MaskDoc => ({ base: 1, ops: [] });
export const invertSelection = (s: MaskDoc | null): MaskDoc => (s ? { ...s, ops: [...s.ops, { type: "invert" }] } : selectAll());
export const featherSelection = (s: MaskDoc, radius: number): MaskDoc => ({ ...s, ops: [...s.ops, { type: "feather", radius }] });
export const expandSelection = (s: MaskDoc, radius: number): MaskDoc => ({ ...s, ops: [...s.ops, { type: "expand", radius }] });

/** Combine modifiers from keyboard state (Shift = add, Alt = subtract, both = intersect). */
export function modeFromModifiers(base: SelectionMode, shift: boolean, alt: boolean): SelectionMode {
  if (shift && alt) return "intersect";
  if (shift) return "add";
  if (alt) return "subtract";
  return base;
}

/**
 * Magic wand: selects pixels whose colour is within `tolerance` (0..255, max
 * channel difference) of the seed. Contiguous uses a scanline flood fill.
 * Returns 0/255 coverage.
 */
export function magicWand(data: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, tolerance: number, contiguous: boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out;
  const si = (sy * w + sx) * 4;
  const r0 = data[si];
  const g0 = data[si + 1];
  const b0 = data[si + 2];
  const a0 = data[si + 3];
  const match = (i: number) => {
    const p = i * 4;
    return (
      Math.abs(data[p] - r0) <= tolerance &&
      Math.abs(data[p + 1] - g0) <= tolerance &&
      Math.abs(data[p + 2] - b0) <= tolerance &&
      Math.abs(data[p + 3] - a0) <= tolerance
    );
  };
  if (!contiguous) {
    for (let i = 0; i < w * h; i++) if (match(i)) out[i] = 255;
    return out;
  }
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    let i = y * w + x;
    while (x >= 0 && !out[i] && match(i)) {
      x--;
      i--;
    }
    x++;
    i++;
    let up = false;
    let down = false;
    while (x < w && !out[i] && match(i)) {
      out[i] = 255;
      if (y > 0) {
        const m = !out[i - w] && match(i - w);
        if (m && !up) stack.push(x, y - 1);
        up = m;
      }
      if (y < h - 1) {
        const m = !out[i + w] && match(i + w);
        if (m && !down) stack.push(x, y + 1);
        down = m;
      }
      x++;
      i++;
    }
  }
  return out;
}

/**
 * Colour range: soft selection by colour distance (Euclidean RGB).
 * Fully selected within `fuzziness/2`, fading to 0 at `fuzziness`.
 */
export function colorRange(data: Uint8ClampedArray, w: number, h: number, rgb: [number, number, number], fuzziness: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const f = Math.max(1, fuzziness);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const d = Math.hypot(data[p] - rgb[0], data[p + 1] - rgb[1], data[p + 2] - rgb[2]);
    const v = d <= f / 2 ? 1 : d >= f ? 0 : 1 - (d - f / 2) / (f / 2);
    out[i] = Math.round(v * 255 * (data[p + 3] / 255));
  }
  return out;
}

/** Bounding box (in the coverage grid) of coverage ≥ threshold, or null if empty. */
export function coverageBounds(cov: Uint8Array | Uint8ClampedArray, w: number, h: number, stride = 1, offset = 0, threshold = 128): { x: number; y: number; w: number; h: number } | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cov[(y * w + x) * stride + offset] >= threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
