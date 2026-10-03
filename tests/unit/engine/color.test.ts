import { describe, expect, it } from "vitest";
import {
  kelvinToLinearRgb,
  linearToSrgb,
  luma,
  srgbToLinear,
  whiteBalanceGains,
  rgbToHsv,
  hsvToRgb,
} from "@/engine/color/math";
import { buildCurveEvaluator, buildCurveTable, sampleCurveTable } from "@/engine/color/curves";
import { parseCubeLut, sampleLut, LutParseError } from "@/engine/color/lut";

describe("transfer functions", () => {
  it("sRGB round-trips", () => {
    for (let v = 0; v <= 1; v += 0.05) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6);
  });
  it("matches known value for mid grey", () => {
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3);
  });
});

describe("HSV", () => {
  it("round-trips", () => {
    const c: [number, number, number] = [0.8, 0.3, 0.1];
    const back = hsvToRgb(rgbToHsv(c));
    back.forEach((v, i) => expect(v).toBeCloseTo(c[i], 6));
  });
});

describe("white balance", () => {
  it("is neutral at zero", () => {
    expect(whiteBalanceGains(0, 0)).toEqual([1, 1, 1]);
  });
  it("warms with positive temperature and cools with negative", () => {
    const warm = whiteBalanceGains(50, 0);
    const cool = whiteBalanceGains(-50, 0);
    expect(warm[0]).toBeGreaterThan(warm[2]);
    expect(cool[2]).toBeGreaterThan(cool[0]);
  });
  it("preserves luminance", () => {
    expect(luma(whiteBalanceGains(80, -30))).toBeCloseTo(1, 6);
  });
  it("positive tint reduces green (magenta)", () => {
    const g = whiteBalanceGains(0, 60);
    expect(g[1]).toBeLessThan(g[0]);
  });
  it("6500K black-body is near-white (within the Planckian/D65 offset)", () => {
    const c = kelvinToLinearRgb(6500);
    expect(Math.abs(c[0] / c[1] - 1)).toBeLessThan(0.1);
    expect(Math.abs(c[2] / c[1] - 1)).toBeLessThan(0.1);
  });
  it("lower temperatures are redder", () => {
    const warm = kelvinToLinearRgb(3200);
    expect(warm[0] / warm[2]).toBeGreaterThan(2);
  });
});

describe("curves", () => {
  it("identity curve is identity", () => {
    const f = buildCurveEvaluator([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    for (let x = 0; x <= 1; x += 0.1) expect(f(x)).toBeCloseTo(x, 6);
  });
  it("passes through control points and stays monotone", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0.25, y: 0.15 },
      { x: 0.75, y: 0.9 },
      { x: 1, y: 1 },
    ];
    const f = buildCurveEvaluator(pts);
    for (const p of pts) expect(f(p.x)).toBeCloseTo(p.y, 6);
    let prev = -1;
    for (let x = 0; x <= 1; x += 0.01) {
      const y = f(x);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });
  it("bakes a sampleable table", () => {
    const id = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    const t = buildCurveTable({
      rgb: id,
      r: [
        { x: 0, y: 1 },
        { x: 1, y: 0 },
      ],
      g: id,
      b: id,
    });
    expect(sampleCurveTable(t, 0, 0.3)).toBeCloseTo(0.3, 3);
    expect(sampleCurveTable(t, 1, 0.3)).toBeCloseTo(0.7, 3);
  });
});

describe(".cube LUT", () => {
  const identityCube = (n: number) => {
    const lines = [`TITLE "id"`, `LUT_3D_SIZE ${n}`];
    for (let b = 0; b < n; b++)
      for (let g = 0; g < n; g++)
        for (let r = 0; r < n; r++) lines.push(`${r / (n - 1)} ${g / (n - 1)} ${b / (n - 1)}`);
    return lines.join("\n");
  };
  it("parses and samples an identity LUT", () => {
    const lut = parseCubeLut(identityCube(5));
    expect(lut.size).toBe(5);
    expect(lut.title).toBe("id");
    const out = sampleLut(lut, [0.33, 0.61, 0.9]);
    expect(out[0]).toBeCloseTo(0.33, 5);
    expect(out[1]).toBeCloseTo(0.61, 5);
    expect(out[2]).toBeCloseTo(0.9, 5);
  });
  it("rejects malformed data", () => {
    expect(() => parseCubeLut("LUT_3D_SIZE 2\n0 0 0\n")).toThrow(LutParseError);
    expect(() => parseCubeLut("LUT_3D_SIZE 999\n")).toThrow(LutParseError);
    expect(() => parseCubeLut("LUT_1D_SIZE 16\n")).toThrow(LutParseError);
  });
});
