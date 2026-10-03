/**
 * Adjustment-layer maths (local adjustments): CPU reference + matching GLSL.
 * Purely per-pixel so they work identically inside any tile.
 */
import type { AdjustmentParams } from "@/types/layers";
import {
  clamp,
  hsvToRgb,
  linearToSrgb,
  rgbToHsv,
  srgbToLinear,
  whiteBalanceGains,
  type Vec3,
} from "@/engine/color/math";

export interface AdjustUniforms {
  exposureMul: number;
  wb: Vec3;
  contrast: number;
  highlights: number;
  shadows: number;
  saturation: number;
  hue: number;
}

export function adjustUniforms(a: AdjustmentParams): AdjustUniforms {
  return {
    exposureMul: Math.pow(2, a.exposure),
    wb: whiteBalanceGains(a.temperature, a.tint),
    contrast: a.contrast / 100,
    highlights: a.highlights / 100,
    shadows: a.shadows / 100,
    saturation: a.saturation / 100,
    hue: a.hue,
  };
}

export function isIdentityAdjustment(a: AdjustmentParams): boolean {
  return Object.values(a).every((v) => v === 0);
}

const LUMA: Vec3 = [0.2126, 0.7152, 0.0722];
const sCurve = (x: number, k: number) => (x < 0.5 ? 0.5 * Math.pow(2 * x, k) : 1 - 0.5 * Math.pow(2 - 2 * x, k));

/** Straight sRGB in → straight sRGB out. */
export function adjustPixel(c: Vec3, u: AdjustUniforms): Vec3 {
  let lin: Vec3 = [
    srgbToLinear(c[0]) * u.exposureMul * u.wb[0],
    srgbToLinear(c[1]) * u.exposureMul * u.wb[1],
    srgbToLinear(c[2]) * u.exposureMul * u.wb[2],
  ];
  if (u.highlights !== 0 || u.shadows !== 0) {
    const y = clamp(linearToSrgb(Math.max(0, lin[0] * LUMA[0] + lin[1] * LUMA[1] + lin[2] * LUMA[2])), 0, 1.5);
    const ms = Math.pow(1 - smooth(0, 0.6, y), 2);
    const mh = Math.pow(smooth(0.4, 1, y), 2);
    const g = Math.pow(2, u.shadows * 1.5 * ms + u.highlights * 1.3 * mh);
    lin = [lin[0] * g, lin[1] * g, lin[2] * g];
  }
  let q: Vec3 = [clamp(linearToSrgb(lin[0])), clamp(linearToSrgb(lin[1])), clamp(linearToSrgb(lin[2]))];
  if (u.contrast !== 0) {
    const k = u.contrast >= 0 ? 1 + u.contrast : 1 + u.contrast * 0.6;
    q = q.map((v) => sCurve(v, k)) as Vec3;
  }
  if (u.saturation !== 0 || u.hue !== 0) {
    const [h, s, v] = rgbToHsv(q);
    q = hsvToRgb([h + u.hue, clamp(s * (1 + u.saturation)), v]).map((x) => clamp(x)) as Vec3;
  }
  return q;
}

function smooth(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export const ADJUST_GLSL = /* glsl */ `
uniform float uAExposure;
uniform vec3 uAWb;
uniform float uAContrast, uAHighlights, uAShadows, uASaturation, uAHue;
float aToLin(float v){ float a=abs(v); float r = a<=0.04045 ? a/12.92 : pow((a+0.055)/1.055,2.4); return v<0.0?-r:r; }
float aToSrgb(float v){ float a=abs(v); float r = a<=0.0031308 ? a*12.92 : 1.055*pow(a,1.0/2.4)-0.055; return v<0.0?-r:r; }
float aS(float x, float k){ return x < 0.5 ? 0.5*pow(2.0*x, k) : 1.0 - 0.5*pow(2.0 - 2.0*x, k); }
vec3 aRgb2hsv(vec3 c){
  float mx = max(c.r, max(c.g, c.b)); float mn = min(c.r, min(c.g, c.b)); float d = mx - mn; float h = 0.0;
  if (d > 1e-9) {
    if (mx == c.r) h = mod((c.g - c.b) / d, 6.0); else if (mx == c.g) h = (c.b - c.r) / d + 2.0; else h = (c.r - c.g) / d + 4.0;
    h *= 60.0; if (h < 0.0) h += 360.0;
  }
  return vec3(h, mx <= 0.0 ? 0.0 : d / mx, mx);
}
vec3 aHsv2rgb(vec3 hsv){
  float hh = mod(mod(hsv.x, 360.0) + 360.0, 360.0) / 60.0; float c = hsv.z * hsv.y;
  float x = c * (1.0 - abs(mod(hh, 2.0) - 1.0)); float m = hsv.z - c; vec3 rgb;
  if (hh < 1.0) rgb = vec3(c, x, 0); else if (hh < 2.0) rgb = vec3(x, c, 0); else if (hh < 3.0) rgb = vec3(0, c, x);
  else if (hh < 4.0) rgb = vec3(0, x, c); else if (hh < 5.0) rgb = vec3(x, 0, c); else rgb = vec3(c, 0, x);
  return rgb + m;
}
vec3 adjustColor(vec3 c){
  vec3 lin = vec3(aToLin(c.r), aToLin(c.g), aToLin(c.b)) * uAExposure * uAWb;
  if (uAHighlights != 0.0 || uAShadows != 0.0) {
    float y = clamp(aToSrgb(max(0.0, dot(lin, vec3(0.2126, 0.7152, 0.0722)))), 0.0, 1.5);
    float ms = pow(1.0 - smoothstep(0.0, 0.6, y), 2.0);
    float mh = pow(smoothstep(0.4, 1.0, y), 2.0);
    lin *= exp2(uAShadows*1.5*ms + uAHighlights*1.3*mh);
  }
  vec3 q = clamp(vec3(aToSrgb(lin.r), aToSrgb(lin.g), aToSrgb(lin.b)), 0.0, 1.0);
  if (uAContrast != 0.0) {
    float k = uAContrast >= 0.0 ? 1.0 + uAContrast : 1.0 + uAContrast*0.6;
    q = vec3(aS(q.r,k), aS(q.g,k), aS(q.b,k));
  }
  if (uASaturation != 0.0 || uAHue != 0.0) {
    vec3 hsv = aRgb2hsv(q);
    hsv.x += uAHue; hsv.y = clamp(hsv.y * (1.0 + uASaturation), 0.0, 1.0);
    q = clamp(aHsv2rgb(hsv), 0.0, 1.0);
  }
  return q;
}
`;
