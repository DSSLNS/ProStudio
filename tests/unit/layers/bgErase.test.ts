import { describe, expect, it } from "vitest";
import { bgEraseDabs } from "@/engine/layers/bgErase";

describe("background eraser", () => {
  it("erases only pixels similar to the sample, within the brush", () => {
    const w = 20;
    const h = 1;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let x = 0; x < w; x++) px.set(x < 10 ? [30, 30, 30, 255] : [220, 220, 220, 255], x * 4);
    const cov = new Uint8Array(w * h);
    bgEraseDabs(px, w, h, cov, [{ x: 10, y: 0.5, size: 16, flow: 1, pressure: 1 }], (x, y) => [x, y], 1, [30, 30, 30], 20, 1);
    expect(cov[5]).toBe(255); // dark, inside the brush
    expect(cov[12]).toBe(0); // bright: not similar
    expect(cov[0]).toBe(0); // dark but outside the brush radius
  });
});
