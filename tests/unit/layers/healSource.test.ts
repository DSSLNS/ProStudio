import { describe, expect, it } from "vitest";
import { findHealSource } from "@/engine/layers/healSource";

describe("spot-heal source search", () => {
  it("prefers a source whose surroundings match the defect's surroundings", () => {
    // Left half dark, right half light; defect on the dark side near the boundary.
    const w = 200;
    const h = 100;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = x < 100 ? 40 : 220;
        px.set([v, v, v, 255], (y * w + x) * 4);
      }
    const off = findHealSource(px, w, h, { x: 60, y: 45, w: 10, h: 10 })!;
    expect(off).not.toBeNull();
    // The chosen source region must stay within the dark half.
    const srcRight = 60 + 10 + Math.round(10 * 0.35) + off[0];
    expect(srcRight).toBeLessThan(100);
  });
  it("returns null when no candidate fits", () => {
    const px = new Uint8ClampedArray(10 * 10 * 4);
    expect(findHealSource(px, 10, 10, { x: 2, y: 2, w: 6, h: 6 })).toBeNull();
  });
});
