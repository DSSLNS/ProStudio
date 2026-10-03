import { describe, expect, it } from "vitest";
import { blendColor, compositePixel } from "@/engine/layers/blend";
import { adjustPixel, adjustUniforms } from "@/engine/layers/adjust";
import { defaultAdjustment, BLEND_MODES } from "@/types/layers";
import type { Vec3 } from "@/engine/color/math";

const close = (a: number[], b: number[], eps = 1e-6) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 5 - Math.round(Math.log10(eps / 1e-6))));

describe("blend modes (W3C)", () => {
  const b: Vec3 = [0.2, 0.5, 0.8];
  const s: Vec3 = [0.6, 0.3, 0.9];
  it("separable modes", () => {
    close(blendColor("multiply", b, s), [0.12, 0.15, 0.72]);
    close(blendColor("screen", b, s), [0.68, 0.65, 0.98]);
    close(blendColor("darken", b, s), [0.2, 0.3, 0.8]);
    close(blendColor("lighten", b, s), [0.6, 0.5, 0.9]);
    close(blendColor("difference", b, s), [0.4, 0.2, 0.1]);
    close(blendColor("normal", b, s), s);
  });
  it("overlay is hard-light with layers swapped", () => {
    close(blendColor("overlay", b, s), blendColor("hard-light", s, b));
  });
  it("soft-light leaves the backdrop unchanged with 50% grey", () => {
    close(blendColor("soft-light", b, [0.5, 0.5, 0.5]), b);
  });
  it("color/luminosity preserve the right luminance", () => {
    const lum = (c: Vec3) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    expect(lum(blendColor("color", b, s))).toBeCloseTo(lum(b), 5);
    expect(lum(blendColor("luminosity", b, s))).toBeCloseTo(lum(s), 5);
  });
  it("all modes stay in range", () => {
    for (const m of BLEND_MODES) for (const v of blendColor(m, b, s)) expect(v >= -1e-9 && v <= 1 + 1e-9).toBe(true);
  });
  it("compositing: opaque normal source replaces, transparent source keeps backdrop", () => {
    close(compositePixel("normal", [0.2, 0.2, 0.2, 1], [0.9, 0.1, 0.4, 1]), [0.9, 0.1, 0.4, 1]);
    close(compositePixel("multiply", [0.2, 0.2, 0.2, 1], [0.9, 0.1, 0.4, 0]), [0.2, 0.2, 0.2, 1]);
    // Over a transparent backdrop the blend mode has no effect.
    close(compositePixel("multiply", [0, 0, 0, 0], [0.9, 0.1, 0.4, 1]), [0.9, 0.1, 0.4, 1]);
  });
});

describe("adjustment layer maths", () => {
  it("identity adjustment is a no-op", () => {
    const u = adjustUniforms(defaultAdjustment());
    close(adjustPixel([0.3, 0.6, 0.9], u), [0.3, 0.6, 0.9]);
  });
  it("+1 EV brightens mid grey by about a stop", () => {
    const out = adjustPixel([0.5, 0.5, 0.5], adjustUniforms({ ...defaultAdjustment(), exposure: 1 }));
    expect(out[0]).toBeGreaterThan(0.65);
    expect(out[0]).toBeLessThan(0.72);
  });
  it("saturation -100 is greyscale", () => {
    const out = adjustPixel([0.8, 0.2, 0.1], adjustUniforms({ ...defaultAdjustment(), saturation: -100 }));
    expect(out[0]).toBeCloseTo(out[1], 6);
  });
});
