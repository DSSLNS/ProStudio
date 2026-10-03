/**
 * Pure image operations used by the AI tasks (no DOM; usable in workers and tests).
 */

export const IMAGENET_MEAN = [0.485, 0.456, 0.406] as const;
export const IMAGENET_STD = [0.229, 0.224, 0.225] as const;

/** Bilinear sample of an RGBA byte image (pixel-centre convention). */
function sampleRGBA(src: Uint8ClampedArray, w: number, h: number, x: number, y: number, c: number): number {
  const fx = Math.min(Math.max(x - 0.5, 0), w - 1);
  const fy = Math.min(Math.max(y - 0.5, 0), h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = src[(y0 * w + x0) * 4 + c];
  const b = src[(y0 * w + x1) * 4 + c];
  const d = src[(y1 * w + x0) * 4 + c];
  const e = src[(y1 * w + x1) * 4 + c];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
}

/** RGBA bytes → planar float CHW [1,3,th,tw], optionally ImageNet-normalised. */
export function toCHW(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  tw: number,
  th: number,
  norm: { mean: readonly number[]; std: readonly number[] } | null,
): Float32Array {
  const out = new Float32Array(3 * tw * th);
  const sx = w / tw;
  const sy = h / th;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      for (let c = 0; c < 3; c++) {
        let v = sampleRGBA(src, w, h, (x + 0.5) * sx, (y + 0.5) * sy, c) / 255;
        if (norm) v = (v - norm.mean[c]) / norm.std[c];
        out[c * tw * th + y * tw + x] = v;
      }
    }
  }
  return out;
}

/** Min–max normalise to 0..1 (as rembg does for U²-Net outputs). */
export function minMaxNormalize(a: Float32Array): Float32Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of a) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const r = hi - lo || 1;
  return a.map((v) => (v - lo) / r);
}

/** Bilinear resize of a single-channel float map. */
export function resizeMap(src: Float32Array, w: number, h: number, tw: number, th: number): Float32Array {
  const out = new Float32Array(tw * th);
  const sx = w / tw;
  const sy = h / th;
  for (let y = 0; y < th; y++) {
    const fy = Math.min(Math.max((y + 0.5) * sy - 0.5, 0), h - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, h - 1);
    const ty = fy - y0;
    for (let x = 0; x < tw; x++) {
      const fx = Math.min(Math.max((x + 0.5) * sx - 0.5, 0), w - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, w - 1);
      const tx = fx - x0;
      out[y * tw + x] =
        (src[y0 * w + x0] * (1 - tx) + src[y0 * w + x1] * tx) * (1 - ty) + (src[y1 * w + x0] * (1 - tx) + src[y1 * w + x1] * tx) * ty;
    }
  }
  return out;
}

/** O(n) box filter (mean over a (2r+1)² window, clamped at edges). */
export function boxFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    let n = 0;
    for (let x = -r; x <= r; x++) if (x >= 0 && x < w) {
        acc += src[y * w + x];
        n++;
      }
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / n;
      const add = x + r + 1;
      const rem = x - r;
      if (add < w) {
        acc += src[y * w + add];
        n++;
      }
      if (rem >= 0) {
        acc -= src[y * w + rem];
        n--;
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    let n = 0;
    for (let y = -r; y <= r; y++) if (y >= 0 && y < h) {
        acc += tmp[y * w + x];
        n++;
      }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      const add = y + r + 1;
      const rem = y - r;
      if (add < h) {
        acc += tmp[add * w + x];
        n++;
      }
      if (rem >= 0) {
        acc -= tmp[rem * w + x];
        n--;
      }
    }
  }
  return out;
}

/**
 * Guided filter (He, Sun & Tang): refines a coarse mask `p` so its edges follow
 * the structure of the guide image `I` (luma) — recovers hair/fur edges far
 * better than plain upsampling.
 */
export function guidedFilter(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const mI = boxFilter(I, w, h, r);
  const mp = boxFilter(p, w, h, r);
  const Ip = new Float32Array(w * h);
  const II = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    Ip[i] = I[i] * p[i];
    II[i] = I[i] * I[i];
  }
  const mIp = boxFilter(Ip, w, h, r);
  const mII = boxFilter(II, w, h, r);
  const a = new Float32Array(w * h);
  const b = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const cov = mIp[i] - mI[i] * mp[i];
    const v = mII[i] - mI[i] * mI[i];
    a[i] = cov / (v + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = boxFilter(a, w, h, r);
  const mb = boxFilter(b, w, h, r);
  const q = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) q[i] = Math.max(0, Math.min(1, ma[i] * I[i] + mb[i]));
  return q;
}

export function lumaOf(src: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = (0.2126 * src[i * 4] + 0.7152 * src[i * 4 + 1] + 0.0722 * src[i * 4 + 2]) / 255;
  return out;
}

export interface Tile {
  /** Input region (including overlap) in source px. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Overlapping tiles covering w×h; edge tiles are shifted inward to keep the full tile size when possible. */
export function planTiles(w: number, h: number, tile: number, overlap: number): Tile[] {
  const step = Math.max(1, tile - 2 * overlap);
  const tiles: Tile[] = [];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const tw = Math.min(tile, w);
      const th = Math.min(tile, h);
      const tx = Math.max(0, Math.min(x - (x ? overlap : 0), w - tw));
      const ty = Math.max(0, Math.min(y - (y ? overlap : 0), h - th));
      tiles.push({ x: tx, y: ty, w: tw, h: th });
      if (x + step >= w) break;
    }
    if (y + step >= h) break;
  }
  return tiles;
}

/** Feather weight for blending overlapping tile outputs (1 inside, ramps to ~0 at tile edges that border other tiles). */
export function tileWeight(t: Tile, W: number, H: number, overlap: number, x: number, y: number): number {
  const ramp = (d: number, atEdge: boolean) => (atEdge ? 1 : Math.min(1, (d + 0.5) / Math.max(1, overlap)));
  return (
    ramp(x, t.x === 0) * ramp(t.w - 1 - x, t.x + t.w >= W) * ramp(y, t.y === 0) * ramp(t.h - 1 - y, t.y + t.h >= H)
  );
}

/** YCbCr skin-tone likelihood (soft), a widely used colour rule (Chai & Ngan). */
export function skinMask(src: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = src[i * 4];
    const g = src[i * 4 + 1];
    const b = src[i * 4 + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    const inCb = Math.max(0, 1 - Math.max(0, Math.abs(cb - 102) - 20) / 8);
    const inCr = Math.max(0, 1 - Math.max(0, Math.abs(cr - 153) - 20) / 8);
    out[i] = y > 40 ? inCb * inCr : 0;
  }
  return out;
}
