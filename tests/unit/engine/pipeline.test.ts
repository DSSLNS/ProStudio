import { describe, expect, it } from "vitest";
import {
  buildDevelopParams,
  developPixel,
  featuresOfPixel,
  hslBandWeights,
  type PixelContext,
} from "@/engine/color/pipeline";
import { buildCurveTable } from "@/engine/color/curves";
import { defaultRecipe, normalizeRecipe, type EditRecipe } from "@/types/edit";
import type { Vec3 } from "@/engine/color/math";

function ctxFor(r: EditRecipe): PixelContext {
  return {
    params: buildDevelopParams(r, false),
    curveTable: buildCurveTable(r.curves),
    lut: null,
    uv: [0.5, 0.5],
    aspect: 1.5,
    noise: 0,
  };
}
const dev = (r: EditRecipe, c: Vec3) => developPixel(c, featuresOfPixel(c), ctxFor(r));

const samples: Vec3[] = [
  [0, 0, 0],
  [1, 1, 1],
  [0.5, 0.5, 0.5],
  [0.9, 0.2, 0.1],
  [0.1, 0.6, 0.3],
  [0.2, 0.3, 0.85],
  [0.73, 0.55, 0.42],
];

describe("develop pipeline", () => {
  it("default recipe is an identity transform (within 8-bit precision)", () => {
    const r = defaultRecipe();
    for (const c of samples) dev(r, c).forEach((v, i) => expect(Math.abs(v - c[i])).toBeLessThan(0.5 / 255));
  });

  it("+1 EV exposure brightens mid grey by about one stop", () => {
    const r = defaultRecipe();
    r.light.exposure = 1;
    const out = dev(r, [0.5, 0.5, 0.5]);
    expect(out[0]).toBeGreaterThan(0.65);
    expect(out[0]).toBeLessThan(0.72);
  });

  it("contrast pivots on mid grey", () => {
    const r = defaultRecipe();
    r.light.contrast = 60;
    expect(dev(r, [0.5, 0.5, 0.5])[0]).toBeCloseTo(0.5, 5);
    expect(dev(r, [0.25, 0.25, 0.25])[0]).toBeLessThan(0.25);
    expect(dev(r, [0.75, 0.75, 0.75])[0]).toBeGreaterThan(0.75);
  });

  it("saturation -100 produces greyscale", () => {
    const r = defaultRecipe();
    r.color.saturation = -100;
    const out = dev(r, [0.9, 0.2, 0.1]);
    expect(out[0]).toBeCloseTo(out[1], 5);
    expect(out[1]).toBeCloseTo(out[2], 5);
  });

  it("highlights -100 darkens bright tones more than shadows", () => {
    const r = defaultRecipe();
    r.light.highlights = -100;
    const bright = dev(r, [0.9, 0.9, 0.9])[0];
    const dark = dev(r, [0.15, 0.15, 0.15])[0];
    expect(0.9 - bright).toBeGreaterThan(0.1);
    expect(Math.abs(0.15 - dark)).toBeLessThan(0.02);
  });

  it("shadows +100 lifts dark tones", () => {
    const r = defaultRecipe();
    r.light.shadows = 100;
    expect(dev(r, [0.1, 0.1, 0.1])[0]).toBeGreaterThan(0.15);
  });

  it("positive temperature warms a neutral grey", () => {
    const r = defaultRecipe();
    r.color.temperature = 60;
    const out = dev(r, [0.5, 0.5, 0.5]);
    expect(out[0]).toBeGreaterThan(out[2]);
  });

  it("curves are applied", () => {
    const r = defaultRecipe();
    r.curves.rgb = [
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ];
    expect(dev(r, [0.2, 0.2, 0.2])[0]).toBeCloseTo(0.8, 2);
  });

  it("negative vignette darkens corners but not the centre", () => {
    const r = defaultRecipe();
    r.effects.vignetteAmount = -100;
    const c = ctxFor(r);
    const grey: Vec3 = [0.6, 0.6, 0.6];
    const centre = developPixel(grey, featuresOfPixel(grey), { ...c, uv: [0.5, 0.5] })[0];
    const corner = developPixel(grey, featuresOfPixel(grey), { ...c, uv: [0.02, 0.02] })[0];
    expect(centre).toBeCloseTo(0.6, 3);
    expect(corner).toBeLessThan(0.3);
  });

  it("outputs stay in range for extreme settings", () => {
    const r = defaultRecipe();
    Object.assign(r.light, {
      exposure: 5,
      contrast: 100,
      highlights: 100,
      shadows: 100,
      whites: 100,
      blacks: -100,
      dehaze: 100,
    });
    Object.assign(r.color, { saturation: 100, vibrance: 100, temperature: 100, tint: -100 });
    for (const c of samples) for (const v of dev(r, c)) expect(v >= 0 && v <= 1 && Number.isFinite(v)).toBe(true);
  });
});

describe("HSL band weights", () => {
  it("form a partition of unity", () => {
    for (let h = 0; h < 360; h += 7) {
      const w = hslBandWeights(h);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
  });
  it("are fully on at band centres", () => {
    expect(hslBandWeights(120)[3]).toBeCloseTo(1, 6);
    expect(hslBandWeights(0)[0]).toBeCloseTo(1, 6);
  });
});

describe("recipe normalisation", () => {
  it("returns defaults for garbage", () => {
    expect(normalizeRecipe("nope")).toEqual(defaultRecipe());
    expect(normalizeRecipe({ light: { exposure: "x" } })).toEqual(defaultRecipe());
  });
  it("keeps valid values and clamps crop", () => {
    const r = normalizeRecipe({
      light: { exposure: 1.5 },
      geometry: { rotation: 90, crop: { x: -1, y: 0.2, width: 5, height: 0.5 } },
    });
    expect(r.light.exposure).toBe(1.5);
    expect(r.geometry.rotation).toBe(90);
    expect(r.geometry.crop).toEqual({ x: 0, y: 0.2, width: 1, height: 0.5 });
  });
  it("rejects invalid rotation", () => {
    expect(normalizeRecipe({ geometry: { rotation: 45 } }).geometry.rotation).toBe(0);
  });
});

describe("AI-assisted auto edit", async () => {
  const { applySubjectExposure } = await import("@/engine/analysis/autoEdit");
  const base = {
    changes: [{ section: "light" as const, key: "exposure", label: "Exposure", value: 0, unit: "EV" }],
    notes: [],
    stats: { median: 0.5, p1: 0.02, p99: 0.8, clipHigh: 0, clipLow: 0, meanSat: 0.3, noise: 1, skinFraction: 0 },
  };
  it("brightens a dark subject on a well-exposed frame", () => {
    const out = applySubjectExposure(base, 0.2, 0.3);
    const ev = out.changes.find((c) => c.key === "exposure")!.value;
    expect(ev).toBeGreaterThan(0.3);
    expect(out.notes[0]).toMatch(/30%/);
  });
  it("respects highlight headroom", () => {
    const out = applySubjectExposure({ ...base, stats: { ...base.stats, p99: 0.97 } }, 0.1, 0.3);
    expect(out.changes.find((c) => c.key === "exposure")?.value ?? 0).toBeLessThan(0.2);
  });
});
