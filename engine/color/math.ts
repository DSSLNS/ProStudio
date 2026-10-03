/** Colour science primitives shared by the CPU pipeline and (mirrored) GLSL shader. */

export type Vec3 = [number, number, number];

export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** sRGB EOTF (encoded → linear). Extended for values > 1 (mirrors around linear slope). */
export function srgbToLinear(v: number): number {
  const a = Math.abs(v);
  const r = a <= 0.04045 ? a / 12.92 : Math.pow((a + 0.055) / 1.055, 2.4);
  return v < 0 ? -r : r;
}

/** sRGB inverse EOTF (linear → encoded). */
export function linearToSrgb(v: number): number {
  const a = Math.abs(v);
  const r = a <= 0.0031308 ? a * 12.92 : 1.055 * Math.pow(a, 1 / 2.4) - 0.055;
  return v < 0 ? -r : r;
}

/** Rec.709 luma weights. */
export const LUMA: Vec3 = [0.2126, 0.7152, 0.0722];
export const luma = (c: Vec3) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];

/** RGB (0..1) → HSV with hue in degrees. */
export function rgbToHsv([r, g, b]: Vec3): Vec3 {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-9) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max <= 0 ? 0 : d / max, max];
}

export function hsvToRgb([h, s, v]: Vec3): Vec3 {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  let rgb: Vec3;
  if (hh < 1) rgb = [c, x, 0];
  else if (hh < 2) rgb = [x, c, 0];
  else if (hh < 3) rgb = [0, c, x];
  else if (hh < 4) rgb = [0, x, c];
  else if (hh < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
}

/**
 * CIE 1931 xy chromaticity of a Planckian (black-body) radiator, using the
 * Kim et al. (2002) cubic spline approximation (1667 K – 25000 K).
 */
export function planckianXY(kelvin: number): [number, number] {
  const T = clamp(kelvin, 1667, 25000);
  const t = 1e3 / T;
  const x =
    T <= 4000
      ? -0.2661239 * t ** 3 - 0.234358 * t ** 2 + 0.8776956 * t + 0.17991
      : -3.0258469 * t ** 3 + 2.1070379 * t ** 2 + 0.2226347 * t + 0.24039;
  let y: number;
  if (T <= 2222) y = -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683;
  else if (T <= 4000) y = -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867;
  else y = 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}

/** Linear-sRGB colour (Y = 1) of a black-body at `kelvin`. */
export function kelvinToLinearRgb(kelvin: number): Vec3 {
  const [x, y] = planckianXY(kelvin);
  const X = x / y;
  const Y = 1;
  const Z = (1 - x - y) / y;
  return [
    3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.969266 * X + 1.8760108 * Y + 0.041556 * Z,
    0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ];
}

/**
 * White-balance gains (linear RGB) for the Temperature/Tint sliders (-100..100).
 * The image is assumed balanced for ~6500 K; +temperature treats the scene light
 * as cooler (bluer) and compensates, i.e. warms the image. Gains are normalised
 * to keep luminance constant.
 */
export function whiteBalanceGains(temperature: number, tint: number): Vec3 {
  if (!temperature && !tint) return [1, 1, 1];
  const ref = kelvinToLinearRgb(6500);
  const scene = kelvinToLinearRgb(6500 * Math.pow(2, (temperature / 100) * 1.1));
  const g: Vec3 = [ref[0] / scene[0], ref[1] / scene[1], ref[2] / scene[2]];
  g[1] *= Math.pow(2, (-tint / 100) * 0.45);
  const l = luma(g);
  return [g[0] / l, g[1] / l, g[2] / l];
}

/** Convert a correlated colour temperature to the Temperature slider value that neutralises it. */
export function kelvinToTemperatureSlider(sceneKelvin: number): number {
  return clamp((Math.log2(sceneKelvin / 6500) / 1.1) * 100, -100, 100);
}
