import { describe, expect, it } from "vitest";
import { boxFilter, guidedFilter, minMaxNormalize, planTiles, resizeMap, skinMask, tileWeight, toCHW } from "@/engine/ai/imageOps";

describe("AI image ops", () => {
  it("toCHW lays out planes and normalises", () => {
    const px = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]); // 2×1: red, green
    const t = toCHW(px, 2, 1, 2, 1, null);
    expect(Array.from(t)).toEqual([1, 0, 0, 1, 0, 0]);
    const n = toCHW(px, 2, 1, 2, 1, { mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] });
    expect(n[0]).toBeCloseTo(1);
    expect(n[1]).toBeCloseTo(-1);
  });
  it("min-max normalise", () => {
    expect(Array.from(minMaxNormalize(new Float32Array([2, 4, 6])))).toEqual([0, 0.5, 1]);
  });
  it("resizeMap preserves constants and interpolates", () => {
    expect(Array.from(resizeMap(new Float32Array([0.3, 0.3, 0.3, 0.3]), 2, 2, 4, 4)).every((v) => Math.abs(v - 0.3) < 1e-6)).toBe(true);
    const up = resizeMap(new Float32Array([0, 1]), 2, 1, 4, 1);
    expect(up[0]).toBeCloseTo(0);
    expect(up[3]).toBeCloseTo(1);
    expect(up[1]).toBeGreaterThan(0);
    expect(up[1]).toBeLessThan(1);
  });
  it("box filter averages", () => {
    const b = boxFilter(new Float32Array([0, 0, 3, 0, 0]), 5, 1, 1);
    expect(b[2]).toBeCloseTo(1);
    expect(b[0]).toBeCloseTo(0);
  });
  it("guided filter snaps a blurry mask to the guide's edge", () => {
    const w = 40;
    const h = 1;
    const I = new Float32Array(w).map((_, x) => (x < 20 ? 0.1 : 0.9));
    const p = new Float32Array(w).map((_, x) => Math.min(1, Math.max(0, (x - 12) / 16))); // soft ramp
    const q = guidedFilter(I, p, w, h, 4, 1e-4);
    expect(q[16]).toBeLessThan(p[16]); // pushed down on the dark side
    expect(q[24]).toBeGreaterThan(p[24]); // pushed up on the bright side
  });
  it("tiles cover the image with overlap and weights blend to 1 in the interior", () => {
    const tiles = planTiles(300, 200, 128, 16);
    const cover = new Float32Array(300 * 200);
    for (const t of tiles) for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) cover[(t.y + y) * 300 + t.x + x] += tileWeight(t, 300, 200, 16, x, y);
    expect(cover.every((v) => v > 0.2)).toBe(true);
    expect(tiles.every((t) => t.w === 128 && t.h === 128)).toBe(true);
  });
  it("small images become a single tile", () => {
    expect(planTiles(50, 40, 128, 16)).toEqual([{ x: 0, y: 0, w: 50, h: 40 }]);
  });
  it("skin mask accepts skin tones and rejects blue", () => {
    const px = new Uint8ClampedArray([224, 172, 140, 255, 40, 90, 200, 255]);
    const m = skinMask(px, 2, 1);
    expect(m[0]).toBeGreaterThan(0.5);
    expect(m[1]).toBe(0);
  });
});
