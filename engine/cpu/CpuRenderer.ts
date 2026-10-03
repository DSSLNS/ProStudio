/**
 * CPU fallback for the develop pipeline (used when WebGL2 is unavailable).
 * Slower than the GPU path but produces the same result from the same maths.
 */
import {
  buildDevelopParams,
  developPixel,
  needsLocalFeatures,
  type LocalFeatures,
  type PixelContext,
} from "@/engine/color/pipeline";
import { buildCurveTable } from "@/engine/color/curves";
import { sampleLut } from "@/engine/color/lut";
import { srgbToLinear, type Vec3 } from "@/engine/color/math";
import { apply, type Mat3 } from "@/engine/image/transform";
import type { EditRecipe } from "@/types/edit";
import type { BlurRadii, LutData } from "@/engine/gl/WebGLRenderer";
import { gaussianBlurPlanes } from "@/engine/filters/blur";

export interface CpuSource {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface FeatureMaps {
  y: Float32Array[]; // [large, medium, small]
  minL: Float32Array;
  cb: Float32Array;
  cr: Float32Array;
}

function computeFeatures(src: CpuSource, radii: BlurRadii): FeatureMaps {
  const n = src.width * src.height;
  const y = new Float32Array(n);
  const mn = new Float32Array(n);
  const cb = new Float32Array(n);
  const cr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = src.data[i * 4] / 255;
    const g = src.data[i * 4 + 1] / 255;
    const b = src.data[i * 4 + 2] / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    y[i] = l;
    mn[i] = Math.min(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));
    cb[i] = b - l;
    cr[i] = r - l;
  }
  const [yL, minL] = gaussianBlurPlanes([y, mn], src.width, src.height, radii.large);
  const [yM, cbM, crM] = gaussianBlurPlanes([y, cb, cr], src.width, src.height, radii.medium);
  const [yS] = gaussianBlurPlanes([y], src.width, src.height, radii.small);
  return { y: [yL, yM, yS], minL, cb: cbM, cr: crM };
}

function bilinear(src: CpuSource, x: number, y: number, out: number[]): boolean {
  if (x < 0 || y < 0 || x > src.width || y > src.height) return false;
  const fx = Math.min(Math.max(x - 0.5, 0), src.width - 1);
  const fy = Math.min(Math.max(y - 0.5, 0), src.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, src.width - 1);
  const y1 = Math.min(y0 + 1, src.height - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  for (let c = 0; c < 4; c++) {
    const a = src.data[(y0 * src.width + x0) * 4 + c];
    const b = src.data[(y0 * src.width + x1) * 4 + c];
    const d = src.data[(y1 * src.width + x0) * 4 + c];
    const e = src.data[(y1 * src.width + x1) * 4 + c];
    out[c] = ((a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty) / 255;
  }
  return true;
}

function sampleFeature(plane: Float32Array, w: number, h: number, x: number, y: number): number {
  const ix = Math.min(w - 1, Math.max(0, Math.floor(x)));
  const iy = Math.min(h - 1, Math.max(0, Math.floor(y)));
  return plane[iy * w + ix];
}

function hash(x: number, y: number): number {
  let px = (x * 123.34) % 1;
  let py = (y * 456.21) % 1;
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d;
  py += d;
  return (px * py) % 1;
}

export interface CpuRenderOptions {
  recipe: EditRecipe;
  width: number;
  height: number;
  outToSrc: Mat3;
  radii: BlurRadii;
  lut: LutData | null;
  tileOffset?: [number, number];
  fullSize?: [number, number];
  grainScale?: number;
  before?: boolean;
  /** Called with progress 0..1 between rows (lets callers yield). */
  onRow?: (fraction: number) => void;
}

export function renderCpu(src: CpuSource, o: CpuRenderOptions): ImageData {
  const params = buildDevelopParams(o.recipe, !!o.lut && o.lut.id === o.recipe.lut?.id);
  const feats = !o.before && needsLocalFeatures(params) ? computeFeatures(src, o.radii) : null;
  const curveTable = params.curvesActive ? buildCurveTable(o.recipe.curves) : null;
  const lut = o.lut;
  const lutFn = lut && params.lutIntensity > 0 ? (rgb: Vec3) => sampleLut(lut, rgb) : null;
  const out = new ImageData(o.width, o.height);
  const full = o.fullSize ?? [o.width, o.height];
  const [ox, oy] = o.tileOffset ?? [0, 0];
  const px = [0, 0, 0, 0];
  const ctx: PixelContext = { params, curveTable, lut: lutFn, uv: [0, 0], aspect: full[0] / full[1], noise: 0 };
  for (let y = 0; y < o.height; y++) {
    for (let x = 0; x < o.width; x++) {
      const gx = x + 0.5 + ox;
      const gy = y + 0.5 + oy;
      const [sx, sy] = apply(o.outToSrc, gx, gy);
      const i = (y * o.width + x) * 4;
      if (!bilinear(src, sx, sy, px)) continue;
      let rgb: Vec3 = [px[0], px[1], px[2]];
      if (!o.before) {
        let f: LocalFeatures;
        if (feats) {
          f = {
            yLarge: sampleFeature(feats.y[0], src.width, src.height, sx, sy),
            minLarge: sampleFeature(feats.minL, src.width, src.height, sx, sy),
            yMedium: sampleFeature(feats.y[1], src.width, src.height, sx, sy),
            cbcrMedium: [
              sampleFeature(feats.cb, src.width, src.height, sx, sy),
              sampleFeature(feats.cr, src.width, src.height, sx, sy),
            ],
            ySmall: sampleFeature(feats.y[2], src.width, src.height, sx, sy),
          };
        } else {
          const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
          f = {
            yLarge: l,
            minLarge: Math.min(...rgb.map(srgbToLinear)),
            yMedium: l,
            cbcrMedium: [rgb[2] - l, rgb[0] - l],
            ySmall: l,
          };
        }
        ctx.uv = [gx / full[0], gy / full[1]];
        const gs = o.grainScale ?? 1;
        ctx.noise = (hash(Math.floor(gx * gs), Math.floor(gy * gs)) - 0.5) / Math.sqrt(Math.max(gs, 1));
        rgb = developPixel(rgb, f, ctx);
      }
      out.data[i] = Math.round(rgb[0] * 255);
      out.data[i + 1] = Math.round(rgb[1] * 255);
      out.data[i + 2] = Math.round(rgb[2] * 255);
      out.data[i + 3] = Math.round(px[3] * 255);
    }
    if (o.onRow && (y & 31) === 0) o.onRow(y / o.height);
  }
  return out;
}
