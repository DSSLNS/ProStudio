/**
 * W3C Compositing & Blending Level 1 blend modes — CPU reference (tests, CPU
 * fallback) and the matching GLSL used by the GPU compositor.
 */
import type { BlendMode } from "@/types/layers";
import { BLEND_MODES } from "@/types/layers";
import type { Vec3 } from "@/engine/color/math";

const lum = (c: Vec3) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clipColor(c: Vec3): Vec3 {
  const l = lum(c);
  const n = Math.min(...c);
  const x = Math.max(...c);
  let out = c;
  if (n < 0) out = out.map((v) => l + ((v - l) * l) / (l - n)) as Vec3;
  if (x > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / (x - l)) as Vec3;
  return out;
}
const setLum = (c: Vec3, l: number): Vec3 => {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
};

function hardLight(b: number, s: number) {
  return s <= 0.5 ? b * 2 * s : 1 - (1 - b) * (1 - (2 * s - 1));
}
function softLight(b: number, s: number) {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (d - b);
}

/** B(Cb, Cs) for straight (non-premultiplied) colours. */
export function blendColor(mode: BlendMode, cb: Vec3, cs: Vec3): Vec3 {
  const sep = (f: (b: number, s: number) => number): Vec3 => [f(cb[0], cs[0]), f(cb[1], cs[1]), f(cb[2], cs[2])];
  switch (mode) {
    case "normal":
      return cs;
    case "multiply":
      return sep((b, s) => b * s);
    case "screen":
      return sep((b, s) => b + s - b * s);
    case "overlay":
      return sep((b, s) => hardLight(s, b));
    case "hard-light":
      return sep(hardLight);
    case "soft-light":
      return sep(softLight);
    case "darken":
      return sep(Math.min);
    case "lighten":
      return sep(Math.max);
    case "difference":
      return sep((b, s) => Math.abs(b - s));
    case "color":
      return setLum(cs, lum(cb));
    case "luminosity":
      return setLum(cb, lum(cs));
  }
}

/** Source-over composite with a blend mode, straight RGBA in → straight RGBA out. */
export function compositePixel(
  mode: BlendMode,
  dst: [number, number, number, number],
  src: [number, number, number, number],
): [number, number, number, number] {
  const ab = dst[3];
  const as = src[3];
  const cb: Vec3 = [dst[0], dst[1], dst[2]];
  const cs: Vec3 = [src[0], src[1], src[2]];
  const B = blendColor(mode, cb, cs);
  const csp = cs.map((v, i) => (1 - ab) * v + ab * B[i]);
  const ao = as + ab * (1 - as);
  if (ao <= 0) return [0, 0, 0, 0];
  const co = csp.map((v, i) => (as * v + (1 - as) * ab * cb[i]) / ao);
  return [co[0], co[1], co[2], ao];
}

export const BLEND_MODE_INDEX: Record<BlendMode, number> = Object.fromEntries(
  BLEND_MODES.map((m, i) => [m, i]),
) as Record<BlendMode, number>;

/** Canvas2D globalCompositeOperation equivalents (used by the CPU compositor). */
export const CANVAS_BLEND: Record<BlendMode, GlobalCompositeOperation> = {
  normal: "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  "soft-light": "soft-light",
  "hard-light": "hard-light",
  darken: "darken",
  lighten: "lighten",
  difference: "difference",
  color: "color",
  luminosity: "luminosity",
};

/** GLSL: premultiplied in/out compositing with all blend modes (indices = BLEND_MODES order). */
export const BLEND_GLSL = /* glsl */ `
float lum3(vec3 c){ return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipColor(vec3 c){
  float l = lum3(c); float n = min(c.r, min(c.g, c.b)); float x = max(c.r, max(c.g, c.b));
  if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-6);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-6);
  return c;
}
vec3 setLum(vec3 c, float l){ return clipColor(c + (l - lum3(c))); }
float hardL(float b, float s){ return s <= 0.5 ? b * 2.0 * s : 1.0 - (1.0 - b) * (1.0 - (2.0 * s - 1.0)); }
float softL(float b, float s){
  if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
  float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return b + (2.0 * s - 1.0) * (d - b);
}
vec3 blendColor(int m, vec3 b, vec3 s){
  if (m == 0) return s;
  if (m == 1) return b * s;
  if (m == 2) return b + s - b * s;
  if (m == 3) return vec3(hardL(s.r, b.r), hardL(s.g, b.g), hardL(s.b, b.b));
  if (m == 4) return vec3(softL(b.r, s.r), softL(b.g, s.g), softL(b.b, s.b));
  if (m == 5) return vec3(hardL(b.r, s.r), hardL(b.g, s.g), hardL(b.b, s.b));
  if (m == 6) return min(b, s);
  if (m == 7) return max(b, s);
  if (m == 8) return abs(b - s);
  if (m == 9) return setLum(s, lum3(b));
  return setLum(b, lum3(s));
}
/** dst/src premultiplied; returns premultiplied. */
vec4 compositeP(int mode, vec4 dst, vec4 src){
  vec3 cb = dst.a > 0.0 ? dst.rgb / dst.a : vec3(0.0);
  vec3 cs = src.a > 0.0 ? src.rgb / src.a : vec3(0.0);
  vec3 B = clamp(blendColor(mode, cb, cs), 0.0, 1.0);
  vec3 csp = (1.0 - dst.a) * cs + dst.a * B;
  return vec4(src.a * csp + (1.0 - src.a) * dst.rgb, src.a + dst.a * (1.0 - src.a));
}
`;
