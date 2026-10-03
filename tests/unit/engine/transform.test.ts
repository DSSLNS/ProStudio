import { describe, expect, it } from "vitest";
import {
  apply,
  homographyFromPoints,
  maxInscribedCrop,
  outputSize,
  outputToSourceMatrix,
  sourceBoundsForOutputRect,
} from "@/engine/image/transform";
import { defaultRecipe } from "@/types/edit";

const geo = () => defaultRecipe().geometry;

describe("geometry", () => {
  it("identity maps output pixels to the same source pixels", () => {
    const m = outputToSourceMatrix(400, 300, geo(), 400, 300);
    expect(apply(m, 10, 20)).toEqual([10, 20]);
  });

  it("preview-scale render maps to full source", () => {
    const m = outputToSourceMatrix(4000, 3000, geo(), 400, 300);
    const [x, y] = apply(m, 400, 300);
    expect(x).toBeCloseTo(4000);
    expect(y).toBeCloseTo(3000);
  });

  it("90° rotation swaps dimensions and maps corners", () => {
    const g = { ...geo(), rotation: 90 as const };
    expect(outputSize(400, 300, g)).toEqual({ width: 300, height: 400 });
    const m = outputToSourceMatrix(400, 300, g, 300, 400);
    // Top-left of a clockwise-rotated image is the source's bottom-left.
    const [x, y] = apply(m, 0, 0);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(300);
  });

  it("horizontal flip mirrors x", () => {
    const m = outputToSourceMatrix(400, 300, { ...geo(), flipH: true }, 400, 300);
    expect(apply(m, 0, 0)[0]).toBeCloseTo(400);
  });

  it("crop selects the right region at full resolution", () => {
    const g = { ...geo(), crop: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } };
    expect(outputSize(400, 300, g)).toEqual({ width: 200, height: 150 });
    const m = outputToSourceMatrix(400, 300, g, 200, 150);
    expect(apply(m, 0, 0)).toEqual([200, 150]);
  });

  it("homography maps the four given points", () => {
    const src: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const dst: [number, number][] = [
      [-10, 0],
      [110, 0],
      [100, 100],
      [0, 100],
    ];
    const h = homographyFromPoints(src, dst);
    src.forEach((p, i) => {
      const [x, y] = apply(h, p[0], p[1]);
      expect(x).toBeCloseTo(dst[i][0], 6);
      expect(y).toBeCloseTo(dst[i][1], 6);
    });
  });

  it("inscribed crop for a straightened image stays inside the rotated frame", () => {
    const c = maxInscribedCrop(4000, 3000, 10);
    expect(c.width).toBeLessThan(1);
    expect(c.x).toBeGreaterThan(0);
    const g = { ...geo(), straighten: 10, crop: c };
    const { width, height } = outputSize(4000, 3000, g);
    const m = outputToSourceMatrix(4000, 3000, g, width, height);
    for (const [x, y] of [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ]) {
      const [sx, sy] = apply(m, x, y);
      expect(sx).toBeGreaterThanOrEqual(-1);
      expect(sy).toBeGreaterThanOrEqual(-1);
      expect(sx).toBeLessThanOrEqual(4001);
      expect(sy).toBeLessThanOrEqual(3001);
    }
  });

  it("tile source bounds include a margin and clamp to the image", () => {
    const m = outputToSourceMatrix(1000, 800, geo(), 1000, 800);
    expect(sourceBoundsForOutputRect(m, { x: 100, y: 100, width: 200, height: 200 }, 1000, 800, 10)).toEqual({
      x: 90,
      y: 90,
      width: 220,
      height: 220,
    });
    expect(sourceBoundsForOutputRect(m, { x: 0, y: 0, width: 50, height: 50 }, 1000, 800, 10)).toEqual({
      x: 0,
      y: 0,
      width: 60,
      height: 60,
    });
  });
});
