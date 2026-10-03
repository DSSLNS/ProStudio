import { describe, expect, it } from "vitest";
import {
  analyzeFrame,
  clipFractions,
  computeHistograms,
  dominantHue,
  dynamicRangeStops,
  estimateWhiteBalance,
  focusPeakingMask,
  histogramPercentile,
  laplacianVariance,
  luma8,
  lumaPlane,
  motionScore,
  regionLinear,
  rgbToCct,
  SRGB_TO_LINEAR,
  zebraMask,
} from "@/camera/frameAnalysis";
import { makeFrame, rng, solid } from "./helpers";

describe("histograms", () => {
  it("counts every pixel in each channel", () => {
    const d = makeFrame(4, 4, (x) => [x * 60, 0, 255]);
    const h = computeHistograms(d, 4, 4);
    expect(h.r[0]).toBe(4);
    expect(h.r[180]).toBe(4);
    expect(h.g[0]).toBe(16);
    expect(h.b[255]).toBe(16);
    expect(h.luma.reduce((a, b) => a + b, 0)).toBe(16);
  });

  it("uses Rec.709 luma weights", () => {
    expect(luma8(255, 255, 255)).toBe(255);
    expect(luma8(0, 255, 0)).toBe(182);
    expect(luma8(0, 0, 0)).toBe(0);
  });

  it("finds percentiles", () => {
    const hist = new Uint32Array(256);
    hist[10] = 50;
    hist[200] = 50;
    expect(histogramPercentile(hist, 0.25)).toBe(10);
    expect(histogramPercentile(hist, 0.75)).toBe(200);
  });
});

describe("clipping and dynamic range", () => {
  it("reports highlight and shadow clip fractions", () => {
    const d = makeFrame(10, 10, (x) => (x < 2 ? [255, 255, 255] : x < 5 ? [0, 0, 0] : [128, 128, 128]));
    const { highlight, shadow } = clipFractions(computeHistograms(d, 10, 10).luma);
    expect(highlight).toBeCloseTo(0.2);
    expect(shadow).toBeCloseTo(0.3);
  });

  it("computes dynamic range in stops from linear values", () => {
    expect(dynamicRangeStops(255, 255)).toBe(0);
    // sRGB 255 vs 128 ≈ 1 / 0.2158 linear ≈ 2.2 stops
    expect(dynamicRangeStops(128, 255)).toBeCloseTo(Math.log2(1 / SRGB_TO_LINEAR[128]), 5);
  });
});

describe("analyzeFrame", () => {
  it("measures mid-grey correctly", () => {
    const s = analyzeFrame(solid(40, 30, 118), 40, 30);
    expect(s.meanLuma).toBeCloseTo(118 / 255, 3);
    expect(s.meanLinear).toBeCloseTo(SRGB_TO_LINEAR[118], 5);
    expect(s.highlightClip).toBe(0);
    expect(s.shadowClip).toBe(0);
    expect(s.dominantHue).toBeNull();
  });

  it("detects a dark centre against a bright surround (backlight)", () => {
    const d = makeFrame(40, 40, (x, y) => (x > 12 && x < 28 && y > 12 && y < 28 ? [20, 20, 20] : [250, 250, 250]));
    const s = analyzeFrame(d, 40, 40);
    expect(s.centerLinear).toBeLessThan(s.edgeLinear * 0.5);
  });

  it("detects blue sky in the top third", () => {
    const d = makeFrame(30, 30, (_x, y) => (y < 10 ? [90, 150, 230] : [60, 110, 40]));
    expect(analyzeFrame(d, 30, 30).skyFraction).toBeGreaterThan(0.9);
  });

  it("measures region luminance", () => {
    const d = makeFrame(10, 10, (x) => (x < 5 ? [255, 255, 255] : [0, 0, 0]));
    expect(regionLinear(d, 10, 10, { x: 0, y: 0, width: 0.5, height: 1 })).toBeCloseTo(1);
    expect(regionLinear(d, 10, 10, { x: 0.5, y: 0, width: 0.5, height: 1 })).toBeCloseTo(0);
  });
});

describe("colour", () => {
  it("finds the dominant hue", () => {
    const d = makeFrame(10, 10, () => [255, 0, 0]);
    expect(dominantHue(d, 10, 10).hue).toBe(5);
    const g = makeFrame(10, 10, () => [0, 200, 0]);
    expect(dominantHue(g, 10, 10).hue).toBe(125);
  });

  it("estimates CCT: neutral ≈ 6500 K, warm lower, cool higher", () => {
    expect(Math.abs(rgbToCct(1, 1, 1) - 6500)).toBeLessThan(150);
    expect(rgbToCct(1, 0.6, 0.3)).toBeLessThan(4000);
    expect(rgbToCct(0.7, 0.8, 1)).toBeGreaterThan(8000);
  });

  it("gray-world WB detects a tungsten-like cast", () => {
    const r = rng(1);
    const d = makeFrame(32, 32, () => {
      const v = 80 + r() * 100;
      return [v * 1.0, v * 0.8, v * 0.55];
    });
    const wb = estimateWhiteBalance(d, 32, 32);
    expect(wb.cct).toBeLessThan(4200);
  });

  it("gray-world WB of a neutral scene is near daylight with no tint", () => {
    const d = solid(32, 32, 128);
    const wb = estimateWhiteBalance(d, 32, 32);
    expect(Math.abs(wb.cct - 6500)).toBeLessThan(150);
    expect(Math.abs(wb.tint)).toBeLessThan(0.01);
  });
});

describe("motion", () => {
  it("is zero for identical frames and positive for changes", () => {
    const a = lumaPlane(solid(8, 8, 100), 8, 8);
    const b = lumaPlane(solid(8, 8, 151), 8, 8);
    expect(motionScore(a, a)).toBe(0);
    expect(motionScore(a, b)).toBeCloseTo(51 / 255);
    expect(motionScore(null, a)).toBe(0);
  });
});

describe("sharpness, peaking and zebra", () => {
  const checker = makeFrame(32, 32, (x, y) => ((((x >> 2) + (y >> 2)) & 1) === 1 ? [255, 255, 255] : [0, 0, 0]));
  const flat = solid(32, 32, 128);

  it("Laplacian variance is high for edges and zero for flat frames", () => {
    expect(laplacianVariance(lumaPlane(checker, 32, 32), 32, 32)).toBeGreaterThan(1000);
    expect(laplacianVariance(lumaPlane(flat, 32, 32), 32, 32)).toBe(0);
  });

  it("focus peaking marks edges only", () => {
    const m = focusPeakingMask(lumaPlane(checker, 32, 32), 32, 32);
    const marked = m.reduce((a, v) => a + (v ? 1 : 0), 0);
    expect(marked).toBeGreaterThan(0);
    expect(marked).toBeLessThan(32 * 32);
    expect(focusPeakingMask(lumaPlane(flat, 32, 32), 32, 32).every((v) => v === 0)).toBe(true);
  });

  it("zebra marks pixels at or above the threshold", () => {
    const d = makeFrame(4, 1, (x) => [x * 80, x * 80, x * 80]);
    expect(Array.from(zebraMask(d, 4, 1, 240))).toEqual([0, 0, 0, 255]);
  });
});
