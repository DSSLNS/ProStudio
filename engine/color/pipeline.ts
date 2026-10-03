/**
 * The develop pipeline, expressed as (1) a flat parameter block derived from the
 * recipe and (2) a CPU reference implementation of the per-pixel maths.
 *
 * The WebGL shader in engine/gl/shaders.ts implements exactly the same steps;
 * the CPU version is the fallback renderer and the oracle for unit tests.
 *
 * Stage order (see IMAGE_ENGINE.md):
 *   noise reduction → white balance → exposure → dehaze → shadows/highlights →
 *   whites/blacks → contrast → brightness/gamma → clarity/texture/sharpen →
 *   hue/saturation/vibrance/HSL → colour grading → colour balance → curves →
 *   LUT → vignette → grain
 */
import type { EditRecipe, HslBand } from "@/types/edit";
import { HSL_BANDS, HSL_BAND_HUES, isDefaultRecipe } from "@/types/edit";
import { clamp, hsvToRgb, linearToSrgb, luma, mix, rgbToHsv, srgbToLinear, whiteBalanceGains, type Vec3 } from "./math";
import { isIdentityCurve, sampleCurveTable } from "./curves";

export interface GradeParams {
  tint: Vec3;
  lum: number;
}

export interface DevelopParams {
  wb: Vec3;
  exposureMul: number;
  dehaze: number;
  shadows: number;
  highlights: number;
  whites: number;
  blacks: number;
  contrast: number;
  brightness: number;
  gamma: number;
  clarity: number;
  texture: number;
  sharpen: number;
  noiseLum: number;
  noiseColor: number;
  hueShift: number; // degrees
  saturation: number;
  vibrance: number;
  hslHue: number[]; // 8, degrees
  hslSat: number[]; // 8, -1..1
  hslLum: number[]; // 8, -1..1
  gradeShadows: GradeParams;
  gradeMidtones: GradeParams;
  gradeHighlights: GradeParams;
  gradeGlobal: GradeParams;
  gradeSplit: number;
  gradePower: number;
  balShadows: Vec3;
  balMidtones: Vec3;
  balHighlights: Vec3;
  curvesActive: boolean;
  lutIntensity: number;
  vignetteAmount: number;
  vignetteMid: number;
  vignetteFeather: number;
  vignetteRoundness: number;
  grain: number;
}

function gradeTint(hue: number, saturation: number): Vec3 {
  if (saturation <= 0) return [0, 0, 0];
  const c = hsvToRgb([hue, 1, 1]);
  const l = luma(c);
  const s = (saturation / 100) * 0.25;
  return [(c[0] - l) * s, (c[1] - l) * s, (c[2] - l) * s];
}

export function buildDevelopParams(r: EditRecipe, hasLut: boolean): DevelopParams {
  const L = r.light;
  const C = r.color;
  const g = r.grading;
  const band = (k: keyof EditRecipe["hsl"][HslBand], scale: number) =>
    HSL_BANDS.map((b) => (r.hsl[b][k] / 100) * scale);
  const toGrade = (w: { hue: number; saturation: number; luminance: number }): GradeParams => ({
    tint: gradeTint(w.hue, w.saturation),
    lum: w.luminance / 100,
  });
  const bal = (v: [number, number, number]): Vec3 => [v[0] / 100, v[1] / 100, v[2] / 100];
  return {
    wb: whiteBalanceGains(C.temperature, C.tint),
    exposureMul: Math.pow(2, L.exposure),
    dehaze: L.dehaze / 100,
    shadows: L.shadows / 100,
    highlights: L.highlights / 100,
    whites: L.whites / 100,
    blacks: L.blacks / 100,
    contrast: L.contrast / 100,
    brightness: L.brightness / 100,
    gamma: clamp(L.gamma, 0.1, 5),
    clarity: L.clarity / 100,
    texture: L.texture / 100,
    sharpen: r.detail.sharpenAmount / 100,
    noiseLum: r.detail.noiseLuminance / 100,
    noiseColor: r.detail.noiseColor / 100,
    hueShift: C.hue,
    saturation: C.saturation / 100,
    vibrance: C.vibrance / 100,
    hslHue: band("hue", 30),
    hslSat: band("saturation", 1),
    hslLum: band("luminance", 1),
    gradeShadows: toGrade(g.shadows),
    gradeMidtones: toGrade(g.midtones),
    gradeHighlights: toGrade(g.highlights),
    gradeGlobal: toGrade(g.global),
    gradeSplit: clamp(0.5 - (g.balance / 100) * 0.3, 0.1, 0.9),
    gradePower: mix(2.5, 0.8, g.blending / 100),
    balShadows: bal(r.colorBalance.shadows),
    balMidtones: bal(r.colorBalance.midtones),
    balHighlights: bal(r.colorBalance.highlights),
    curvesActive: !(["rgb", "r", "g", "b"] as const).every((ch) => isIdentityCurve(r.curves[ch])),
    lutIntensity: hasLut && r.lut ? r.lut.intensity / 100 : 0,
    vignetteAmount: r.effects.vignetteAmount / 100,
    vignetteMid: r.effects.vignetteMidpoint / 100,
    vignetteFeather: r.effects.vignetteFeather / 100,
    vignetteRoundness: r.effects.vignetteRoundness / 100,
    grain: r.effects.grain / 100,
  };
}

/** True when the recipe needs blurred "local" feature maps (saves GPU work when false). */
export function needsLocalFeatures(p: DevelopParams): boolean {
  return (
    p.shadows !== 0 ||
    p.highlights !== 0 ||
    p.dehaze !== 0 ||
    p.clarity !== 0 ||
    p.texture !== 0 ||
    p.sharpen !== 0 ||
    p.noiseLum !== 0 ||
    p.noiseColor !== 0
  );
}

export { isDefaultRecipe };

/** Blurred neighbourhood features sampled at the pixel (all from the unadjusted source). */
export interface LocalFeatures {
  /** Large-radius blurred luma (perceptual). */
  yLarge: number;
  /** Large-radius blurred min(R,G,B) in linear light. */
  minLarge: number;
  /** Medium-radius blurred luma (perceptual). */
  yMedium: number;
  /** Medium-radius blurred chroma (Cb, Cr). */
  cbcrMedium: [number, number];
  /** Small-radius blurred luma (perceptual). */
  ySmall: number;
}

export function featuresOfPixel(c: Vec3): LocalFeatures {
  const y = luma(c);
  return {
    yLarge: y,
    minLarge: Math.min(srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])),
    yMedium: y,
    cbcrMedium: [c[2] - y, c[0] - y],
    ySmall: y,
  };
}

// Hue-band weights: piecewise-smooth partition of unity over the 8 band centres.
const CENTERS = HSL_BANDS.map((b) => HSL_BAND_HUES[b]);
export function hslBandWeights(hue: number): number[] {
  const h = ((hue % 360) + 360) % 360;
  const w = new Array(8).fill(0);
  for (let i = 0; i < 8; i++) {
    const a = CENTERS[i];
    const b = i === 7 ? CENTERS[0] + 360 : CENTERS[i + 1];
    const hh = h < a ? h + 360 : h;
    if (hh >= a && hh < b) {
      let t = (hh - a) / (b - a);
      t = t * t * (3 - 2 * t);
      w[i] = 1 - t;
      w[(i + 1) % 8] = t;
      break;
    }
  }
  return w;
}

function sCurve(x: number, k: number): number {
  return x < 0.5 ? 0.5 * Math.pow(2 * x, k) : 1 - 0.5 * Math.pow(2 - 2 * x, k);
}

export function toneMasks(y: number, split: number, power: number): [number, number, number] {
  const ws = Math.pow(clamp(1 - y / split), power);
  const wh = Math.pow(clamp((y - split) / (1 - split)), power);
  return [ws, clamp(1 - ws - wh), wh];
}

export interface PixelContext {
  params: DevelopParams;
  curveTable: Float32Array | null;
  lut: ((rgb: Vec3) => Vec3) | null;
  /** Output-image normalised coordinate (0..1) and aspect (w/h) for vignette. */
  uv: [number, number];
  aspect: number;
  /** Deterministic grain noise in -0.5..0.5 for this pixel. */
  noise: number;
}

/** CPU reference: develop one sRGB-encoded pixel (0..1). */
export function developPixel(src: Vec3, f: LocalFeatures, ctx: PixelContext): Vec3 {
  const p = ctx.params;
  let c: Vec3 = [src[0], src[1], src[2]];
  const ySrc = luma(c);

  // 1. Noise reduction (edge-aware luminance smoothing + chroma smoothing).
  if (p.noiseLum > 0 || p.noiseColor > 0) {
    let y = ySrc;
    let cb = c[2] - y;
    let cr = c[0] - y;
    if (p.noiseLum > 0) {
      const d = y - f.ySmall;
      const edge = Math.exp(-(d * d) / (0.0025 + p.noiseLum * 0.01));
      y = mix(y, mix(f.ySmall, f.yMedium, 0.5 * p.noiseLum), p.noiseLum * edge);
    }
    if (p.noiseColor > 0) {
      cb = mix(cb, f.cbcrMedium[0], p.noiseColor);
      cr = mix(cr, f.cbcrMedium[1], p.noiseColor);
    }
    const r = cr + y;
    const b = cb + y;
    const g = (y - LUMA_R * r - LUMA_B * b) / LUMA_G;
    c = [r, g, b];
  }

  // 2–3. White balance and exposure in linear light.
  let lin: Vec3 = [
    srgbToLinear(c[0]) * p.wb[0] * p.exposureMul,
    srgbToLinear(c[1]) * p.wb[1] * p.exposureMul,
    srgbToLinear(c[2]) * p.wb[2] * p.exposureMul,
  ];

  // 4. Dehaze (dark-channel prior with white airlight).
  if (p.dehaze > 0) {
    const t = Math.max(1 - p.dehaze * 0.95 * clamp(f.minLarge * p.exposureMul), 0.1);
    const A = 0.95;
    lin = lin.map((v) => (v - A) / t + A) as Vec3;
  } else if (p.dehaze < 0) {
    const t = 1 + p.dehaze * 0.6;
    lin = lin.map((v) => v * t + 0.8 * (1 - t)) as Vec3;
  }

  // 5. Shadows / highlights — local exposure driven by blurred luminance.
  if (p.shadows !== 0 || p.highlights !== 0) {
    const yl = linearToSrgb(srgbToLinear(f.yLarge) * p.exposureMul);
    const yp = clamp(linearToSrgb(Math.max(0, luma(lin))), 0, 1.5);
    const lb = mix(yp, yl, 0.65);
    const ms = Math.pow(1 - smooth(0, 0.6, lb), 2);
    const mh = Math.pow(smooth(0.4, 1.0, lb), 2);
    const gain = Math.pow(2, p.shadows * 1.5 * ms + p.highlights * 1.3 * mh);
    lin = [lin[0] * gain, lin[1] * gain, lin[2] * gain];
  }

  let q: Vec3 = [linearToSrgb(lin[0]), linearToSrgb(lin[1]), linearToSrgb(lin[2])];

  // 6. Whites / blacks.
  if (p.whites !== 0 || p.blacks !== 0) {
    q = q.map((v) => {
      let x = Math.max(0, v);
      x = x * (1 + p.whites * 0.22 * Math.min(x, 1.5) ** 2);
      x = x + p.blacks * 0.12 * Math.pow(1 - clamp(x), 3);
      return x;
    }) as Vec3;
  }
  q = q.map((v) => clamp(v)) as Vec3;

  // 7. Contrast (S-curve pivoting on mid-grey).
  if (p.contrast !== 0) {
    const k = p.contrast >= 0 ? 1 + p.contrast : 1 + p.contrast * 0.6;
    q = q.map((v) => sCurve(v, k)) as Vec3;
  }
  // 8. Brightness (midtone power) and gamma.
  if (p.brightness !== 0 || p.gamma !== 1) {
    const e = Math.pow(2, -p.brightness * 0.8) / p.gamma;
    q = q.map((v) => Math.pow(v, e)) as Vec3;
  }

  // 9. Clarity / texture / sharpening (luminance detail layers).
  if (p.clarity !== 0 || p.texture !== 0 || p.sharpen !== 0) {
    const y = luma(q);
    const mid = 1 - (2 * y - 1) ** 2;
    const dY =
      p.clarity * 1.2 * (ySrc - f.yLarge) * mid +
      p.texture * 1.0 * (ySrc - f.yMedium) +
      p.sharpen * 1.5 * (ySrc - f.ySmall);
    q = [q[0] + dY, q[1] + dY, q[2] + dY];
    q = q.map((v) => clamp(v)) as Vec3;
  }

  // 10. Hue / saturation / vibrance / HSL mixer.
  const hslActive = p.hslHue.some(Boolean) || p.hslSat.some(Boolean) || p.hslLum.some(Boolean);
  if (p.hueShift !== 0 || p.saturation !== 0 || p.vibrance !== 0 || hslActive) {
    let [h, s, v] = rgbToHsv(q);
    const s0 = s;
    h += p.hueShift;
    if (hslActive) {
      const w = hslBandWeights(h);
      let dh = 0;
      let ds = 0;
      let dl = 0;
      for (let i = 0; i < 8; i++) {
        dh += w[i] * p.hslHue[i];
        ds += w[i] * p.hslSat[i];
        dl += w[i] * p.hslLum[i];
      }
      h += dh * s0;
      s *= 1 + ds;
      v *= Math.pow(2, dl * 0.8 * s0);
    }
    s *= 1 + p.saturation;
    if (p.vibrance !== 0) {
      const skin = Math.exp(-((((h - 30 + 540) % 360) - 180) ** 2) / (2 * 18 * 18));
      s *= 1 + p.vibrance * (1 - s) * (p.vibrance > 0 ? 1 - 0.5 * skin : 1);
    }
    q = hsvToRgb([h, clamp(s), v]).map((x) => clamp(x)) as Vec3;
  }

  // 11. Colour grading wheels.
  {
    const y = luma(q);
    const [ws, wm, wh] = toneMasks(y, p.gradeSplit, p.gradePower);
    const G = [p.gradeShadows, p.gradeMidtones, p.gradeHighlights];
    const W = [ws, wm, wh];
    let lum = p.gradeGlobal.lum;
    const add: Vec3 = [...p.gradeGlobal.tint];
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 3; k++) add[k] += W[i] * G[i].tint[k];
      lum += W[i] * G[i].lum;
    }
    q = q.map((v, k) => clamp((v + add[k]) * (1 + lum * 0.5))) as Vec3;
  }

  // 12. Colour balance (fixed tonal masks).
  {
    const [ws, wm, wh] = toneMasks(luma(q), 0.5, 1.5);
    q = q.map((v, k) =>
      clamp(v + (ws * p.balShadows[k] + wm * p.balMidtones[k] + wh * p.balHighlights[k]) * 0.12),
    ) as Vec3;
  }

  // 13. Curves (master then per-channel).
  if (p.curvesActive && ctx.curveTable) {
    const t = ctx.curveTable;
    q = q.map((v, k) => sampleCurveTable(t, (k + 1) as 1 | 2 | 3, sampleCurveTable(t, 0, v))) as Vec3;
  }

  // 14. 3D LUT.
  if (p.lutIntensity > 0 && ctx.lut) {
    const l = ctx.lut(q);
    q = q.map((v, k) => clamp(mix(v, l[k], p.lutIntensity))) as Vec3;
  }

  // 15. Post-crop vignette.
  if (p.vignetteAmount !== 0) {
    const v = vignetteFactor(ctx.uv, ctx.aspect, p);
    q =
      p.vignetteAmount < 0
        ? (q.map((x) => x * (1 + p.vignetteAmount * v)) as Vec3)
        : (q.map((x) => mix(x, 1, p.vignetteAmount * v)) as Vec3);
  }

  // 16. Film grain (luminance noise, strongest in midtones).
  if (p.grain > 0) {
    const y = luma(q);
    const n = ctx.noise * p.grain * 0.18 * (1 - Math.abs(2 * y - 1) * 0.6);
    q = q.map((x) => clamp(x + n)) as Vec3;
  }
  return q;
}

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

function smooth(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export function vignetteFactor(
  uv: [number, number],
  aspect: number,
  p: Pick<DevelopParams, "vignetteMid" | "vignetteFeather" | "vignetteRoundness">,
): number {
  let dx = (uv[0] - 0.5) * 2;
  let dy = (uv[1] - 0.5) * 2;
  const round = Math.max(p.vignetteRoundness, 0);
  if (aspect > 1) dx *= mix(1, aspect, round);
  else dy *= mix(1, 1 / aspect, round);
  const pw = 2 + Math.max(-p.vignetteRoundness, 0) * 6;
  const dist = Math.pow(Math.abs(dx) ** pw + Math.abs(dy) ** pw, 1 / pw);
  const mid = mix(0.3, 1.3, p.vignetteMid);
  const fe = mix(0.05, 1.0, p.vignetteFeather);
  return smooth(mid - fe * 0.5, mid + fe * 0.5, dist);
}
