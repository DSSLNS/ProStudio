import { describe, expect, it } from "vitest";
import { pressureScale, StrokeSmoother, strokeBounds, strokeDabs } from "@/engine/layers/dabs";
import { normalizeBrush } from "@/types/layers";

const brush = normalizeBrush({ size: 20, spacing: 0.25, pressureSize: false });

describe("brush dabs", () => {
  it("a click is one dab", () => {
    expect(strokeDabs([10, 10, 1], brush)).toHaveLength(1);
  });
  it("dabs are evenly spaced along the stroke", () => {
    const dabs = strokeDabs([0, 0, 1, 100, 0, 1], brush); // spacing 5px
    expect(dabs.length).toBe(21);
    for (let i = 1; i < dabs.length; i++) expect(dabs[i].x - dabs[i - 1].x).toBeCloseTo(5, 6);
  });
  it("spacing carries across polyline segments", () => {
    const dabs = strokeDabs([0, 0, 1, 3, 0, 1, 10, 0, 1], brush);
    expect(dabs.map((d) => d.x)).toEqual([0, 5, 10]);
  });
  it("pressure scales size when enabled", () => {
    expect(pressureScale(0, true)).toBeCloseTo(0.15);
    expect(pressureScale(1, true)).toBe(1);
    expect(pressureScale(0.1, false)).toBe(1);
    const p = normalizeBrush({ size: 20, pressureSize: true });
    const dabs = strokeDabs([0, 0, 0.2, 50, 0, 1], p);
    expect(dabs[0].size).toBeLessThan(dabs[dabs.length - 1].size);
  });
  it("bounds include the brush radius", () => {
    expect(strokeBounds([10, 10, 1, 20, 30, 1], brush)).toEqual({ x0: -2, y0: -2, x1: 32, y1: 42 });
  });
  it("smoother reduces jitter but follows the stroke", () => {
    const s = new StrokeSmoother(0.5);
    s.push(0, 0, 1);
    const [x] = s.push(10, 0, 1);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(10);
  });
});
