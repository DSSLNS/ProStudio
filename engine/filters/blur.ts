/**
 * CPU Gaussian blur approximated by three successive box blurs (Kovesi's
 * method) — O(n) per pass regardless of radius. Operates on float planes.
 */

function boxSizesForGauss(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}

function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r - 1; x < r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      acc += src[row + Math.min(w - 1, x + r)] - src[row + Math.max(0, x - r - 1)];
      dst[row + x] = acc * iarr;
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number) {
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r - 1; y < r; y++) acc += src[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      acc += src[Math.min(h - 1, y + r) * w + x] - src[Math.max(0, y - r - 1) * w + x];
      dst[y * w + x] = acc * iarr;
    }
  }
}

/** Exact separable Gaussian for small sigmas (box approximation is too coarse there). */
function smallGaussian(plane: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const sum = k.reduce((a, b) => a + b, 0);
  const kn = k.map((v) => v / sum);
  const tmp = new Float32Array(plane.length);
  const out = new Float32Array(plane.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += kn[i + r] * plane[y * w + Math.min(w - 1, Math.max(0, x + i))];
      tmp[y * w + x] = acc;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += kn[i + r] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x];
      out[y * w + x] = acc;
    }
  return out;
}

export function gaussianBlur(plane: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma < 0.3) return plane.slice();
  if (sigma < 2) return smallGaussian(plane, w, h, sigma);
  const sizes = boxSizesForGauss(sigma);
  const a = plane.slice();
  const b = new Float32Array(plane.length);
  for (const s of sizes) {
    const r = (s - 1) / 2;
    if (r < 1) continue;
    boxBlurH(a, b, w, h, r);
    boxBlurV(b, a, w, h, r);
  }
  return a;
}

export function gaussianBlurPlanes(planes: Float32Array[], w: number, h: number, sigma: number): Float32Array[] {
  return planes.map((p) => gaussianBlur(p, w, h, sigma));
}
