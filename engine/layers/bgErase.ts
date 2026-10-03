/**
 * Background eraser core: for each dab, mark pixels whose colour is within
 * `tolerance` of the sampled colour, weighted by the brush falloff.
 * Pure function on a render-resolution coverage buffer (unit-tested).
 */
import type { Dab } from "./dabs";

export function bgEraseDabs(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  coverage: Uint8Array,
  dabs: Dab[],
  toRender: (x: number, y: number) => [number, number],
  scale: number,
  sample: [number, number, number],
  tolerance: number, // 0..255 max-channel distance
  hardness: number,
) {
  for (const d of dabs) {
    const [cx, cy] = toRender(d.x, d.y);
    const r = (d.size / 2) * scale;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / Math.max(r, 0.5);
        if (dist > 1) continue;
        const i = y * w + x;
        const p = i * 4;
        const diff = Math.max(Math.abs(pixels[p] - sample[0]), Math.abs(pixels[p + 1] - sample[1]), Math.abs(pixels[p + 2] - sample[2]));
        if (diff > tolerance) continue;
        const fall = dist <= hardness ? 1 : 1 - (dist - hardness) / Math.max(1e-6, 1 - hardness);
        // Accumulate like overlapping brush dabs: c' = 1 − (1 − c)(1 − v).
        const v = fall * d.flow;
        coverage[i] = Math.round(255 * (1 - (1 - coverage[i] / 255) * (1 - v)));
      }
    }
  }
}
