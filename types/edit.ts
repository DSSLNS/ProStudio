/**
 * The non-destructive edit recipe. This JSON document fully describes an edit;
 * the original image bytes are never modified. Preview and export both render
 * the recipe from the source — export always from the full-resolution original.
 */

export interface CurvePoint {
  x: number; // 0..1 input
  y: number; // 0..1 output
}

export type CurveChannel = "rgb" | "r" | "g" | "b";
export type Curves = Record<CurveChannel, CurvePoint[]>;

export const HSL_BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;
export type HslBand = (typeof HSL_BANDS)[number];
/** Band centre hues in degrees. */
export const HSL_BAND_HUES: Record<HslBand, number> = {
  red: 0,
  orange: 30,
  yellow: 60,
  green: 120,
  aqua: 180,
  blue: 225,
  purple: 270,
  magenta: 315,
};

export interface HslAdjust {
  hue: number; // -100..100 (±30° shift at extremes)
  saturation: number; // -100..100
  luminance: number; // -100..100
}

export interface GradeWheel {
  hue: number; // 0..360
  saturation: number; // 0..100
  luminance: number; // -100..100
}

export interface CropRect {
  /** Normalized to the oriented (rotated/flipped) image, 0..1. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Geometry {
  /** Quarter-turn rotation, clockwise. */
  rotation: 0 | 90 | 180 | 270;
  /** Fine rotation in degrees (-45..45). */
  straighten: number;
  flipH: boolean;
  flipV: boolean;
  crop: CropRect | null;
  /** Keystone correction, -100..100. */
  perspectiveV: number;
  perspectiveH: number;
  /** Shear, -100..100 (±30°). */
  skewX: number;
  skewY: number;
  /** Uniform scale percentage applied around centre (50..200). */
  scale: number;
}

export interface EditRecipe {
  version: 1;
  geometry: Geometry;
  light: {
    exposure: number; // EV, -5..5
    contrast: number; // -100..100
    highlights: number;
    shadows: number;
    whites: number;
    blacks: number;
    brightness: number;
    gamma: number; // 0.2..3 (1 = neutral)
    clarity: number;
    texture: number;
    dehaze: number;
  };
  color: {
    temperature: number; // -100..100
    tint: number; // -100..100
    vibrance: number;
    saturation: number;
    hue: number; // -180..180 degrees
  };
  hsl: Record<HslBand, HslAdjust>;
  curves: Curves;
  grading: {
    shadows: GradeWheel;
    midtones: GradeWheel;
    highlights: GradeWheel;
    global: GradeWheel;
    blending: number; // 0..100
    balance: number; // -100..100
  };
  /** Photoshop-style color balance: cyan↔red, magenta↔green, yellow↔blue per tonal range (-100..100). */
  colorBalance: {
    shadows: [number, number, number];
    midtones: [number, number, number];
    highlights: [number, number, number];
  };
  detail: {
    sharpenAmount: number; // 0..150
    sharpenRadius: number; // 0.5..3 px (at full resolution)
    noiseLuminance: number; // 0..100
    noiseColor: number; // 0..100
  };
  effects: {
    vignetteAmount: number; // -100..100
    vignetteMidpoint: number; // 0..100
    vignetteFeather: number; // 0..100
    vignetteRoundness: number; // -100..100
    grain: number; // 0..100
  };
  lut: { id: string; name: string; intensity: number } | null;
}

export const IDENTITY_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

const wheel = (): GradeWheel => ({ hue: 0, saturation: 0, luminance: 0 });

export function defaultRecipe(): EditRecipe {
  return {
    version: 1,
    geometry: {
      rotation: 0,
      straighten: 0,
      flipH: false,
      flipV: false,
      crop: null,
      perspectiveV: 0,
      perspectiveH: 0,
      skewX: 0,
      skewY: 0,
      scale: 100,
    },
    light: {
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      brightness: 0,
      gamma: 1,
      clarity: 0,
      texture: 0,
      dehaze: 0,
    },
    color: { temperature: 0, tint: 0, vibrance: 0, saturation: 0, hue: 0 },
    hsl: Object.fromEntries(
      (["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const).map((b) => [
        b,
        { hue: 0, saturation: 0, luminance: 0 },
      ]),
    ) as Record<HslBand, HslAdjust>,
    curves: {
      rgb: IDENTITY_CURVE.map((p) => ({ ...p })),
      r: IDENTITY_CURVE.map((p) => ({ ...p })),
      g: IDENTITY_CURVE.map((p) => ({ ...p })),
      b: IDENTITY_CURVE.map((p) => ({ ...p })),
    },
    grading: {
      shadows: wheel(),
      midtones: wheel(),
      highlights: wheel(),
      global: wheel(),
      blending: 50,
      balance: 0,
    },
    colorBalance: { shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0] },
    detail: { sharpenAmount: 0, sharpenRadius: 1, noiseLuminance: 0, noiseColor: 0 },
    effects: { vignetteAmount: 0, vignetteMidpoint: 50, vignetteFeather: 50, vignetteRoundness: 0, grain: 0 },
    lut: null,
  };
}

/** Partial update helper type for nested recipe sections. */
export type RecipeSection = Exclude<keyof EditRecipe, "version">;

/**
 * Defensive normalisation for recipes loaded from storage or imported files:
 * fills in missing fields with defaults and clamps numbers. Never trusts input shape.
 */
export function normalizeRecipe(input: unknown): EditRecipe {
  const base = defaultRecipe();
  if (!input || typeof input !== "object") return base;
  const src = input as Record<string, unknown>;
  const mergeNumbers = <T extends object>(target: T, value: unknown): T => {
    if (!value || typeof value !== "object") return target;
    const out = { ...target } as Record<string, unknown>;
    for (const [k, v] of Object.entries(target)) {
      const incoming = (value as Record<string, unknown>)[k];
      if (typeof v === "number" && typeof incoming === "number" && Number.isFinite(incoming)) out[k] = incoming;
      else if (typeof v === "boolean" && typeof incoming === "boolean") out[k] = incoming;
      else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = mergeNumbers(v as object, incoming);
      else if (
        Array.isArray(v) &&
        Array.isArray(incoming) &&
        incoming.length === v.length &&
        incoming.every((n) => typeof n === "number" && Number.isFinite(n))
      )
        out[k] = incoming;
    }
    return out as T;
  };
  base.light = mergeNumbers(base.light, src.light);
  base.color = mergeNumbers(base.color, src.color);
  base.hsl = mergeNumbers(base.hsl, src.hsl);
  base.grading = mergeNumbers(base.grading, src.grading);
  base.colorBalance = mergeNumbers(base.colorBalance, src.colorBalance);
  base.detail = mergeNumbers(base.detail, src.detail);
  base.effects = mergeNumbers(base.effects, src.effects);
  const g = mergeNumbers(base.geometry, src.geometry);
  g.rotation = ([0, 90, 180, 270] as const).includes(g.rotation) ? g.rotation : 0;
  const crop = (src.geometry as Record<string, unknown> | undefined)?.crop as
    Record<string, unknown> | null | undefined;
  g.crop =
    crop && ["x", "y", "width", "height"].every((k) => typeof crop[k] === "number")
      ? {
          x: clamp01(crop.x as number),
          y: clamp01(crop.y as number),
          width: Math.max(0.001, Math.min(1, crop.width as number)),
          height: Math.max(0.001, Math.min(1, crop.height as number)),
        }
      : null;
  base.geometry = g;
  const curves = src.curves as Record<string, unknown> | undefined;
  if (curves) {
    for (const ch of ["rgb", "r", "g", "b"] as const) {
      const pts = curves[ch];
      if (Array.isArray(pts) && pts.length >= 2 && pts.length <= 32) {
        const valid = pts
          .filter((p): p is CurvePoint => !!p && typeof p.x === "number" && typeof p.y === "number")
          .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }))
          .sort((a, b) => a.x - b.x);
        if (valid.length >= 2) base.curves[ch] = valid;
      }
    }
  }
  const lut = src.lut as Record<string, unknown> | null | undefined;
  if (lut && typeof lut.id === "string" && typeof lut.name === "string" && typeof lut.intensity === "number") {
    base.lut = { id: lut.id, name: lut.name.slice(0, 200), intensity: Math.max(0, Math.min(100, lut.intensity)) };
  }
  return base;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function isDefaultRecipe(r: EditRecipe): boolean {
  return JSON.stringify(r) === JSON.stringify(defaultRecipe());
}
