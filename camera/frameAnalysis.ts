/**
 * Pure analysis of small RGBA frames (typically ~160 px wide, sampled from the
 * live preview). No DOM access — every function takes a Uint8ClampedArray and
 * dimensions so it can be unit-tested and run in a worker.
 */

export interface Histograms {
  luma: Uint32Array;
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
}

export interface WhiteBalanceEstimate {
  /** Mean channel values (0..1, gamma-encoded) over mid-tone, unsaturated pixels. */
  r: number;
  g: number;
  b: number;
  /** Approximate correlated colour temperature of the illuminant in Kelvin (gray-world). */
  cct: number;
  /** Green/magenta deviation: + = green cast, − = magenta cast (roughly −1..1). */
  tint: number;
}

export interface FrameStats {
  width: number;
  height: number;
  histograms: Histograms;
  /** Mean gamma-encoded luma 0..1. */
  meanLuma: number;
  /** Mean linear luminance 0..1. */
  meanLinear: number;
  /** Center-weighted mean linear luminance (centre 50% weighted 3×). */
  centerWeightedLinear: number;
  centerLinear: number;
  edgeLinear: number;
  topLinear: number;
  bottomLinear: number;
  highlightClip: number;
  shadowClip: number;
  /** Stops between 1st and 99th luminance percentiles (approximate scene dynamic range). */
  dynamicRange: number;
  p01: number;
  p50: number;
  p99: number;
  /** 0..360 or null if the frame is essentially neutral. */
  dominantHue: number | null;
  meanSaturation: number;
  /** Fraction of the top third that looks like blue sky. */
  skyFraction: number;
  /** Fraction of pixels that are warm and saturated (orange/red). */
  warmFraction: number;
  /** Fraction of near-white, low-saturation pixels. */
  paperFraction: number;
  whiteBalance: WhiteBalanceEstimate;
  /** Mean gradient magnitude (0..~1). */
  edgeDensity: number;
  /** Fraction of strong edges that are near-horizontal or near-vertical. */
  rectilinearity: number;
  /** Laplacian variance over the whole frame. */
  sharpness: number;
  centerSharpness: number;
  edgeSharpness: number;
}

/** sRGB (0..255) → linear light (0..1) lookup table. */
export const SRGB_TO_LINEAR: Float32Array = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

export const linearToSrgb = (v: number): number => {
  const c = Math.max(0, Math.min(1, v));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
};

/** Rec.709 luma of gamma-encoded components, rounded to 0..255. */
export const luma8 = (r: number, g: number, b: number): number => (r * 0.2126 + g * 0.7152 + b * 0.0722 + 0.5) | 0;

export function computeHistograms(data: Uint8ClampedArray, width: number, height: number): Histograms {
  const luma = new Uint32Array(256);
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const n = width * height * 4;
  for (let i = 0; i < n; i += 4) {
    r[data[i]]++;
    g[data[i + 1]]++;
    b[data[i + 2]]++;
    luma[luma8(data[i], data[i + 1], data[i + 2])]++;
  }
  return { luma, r, g, b };
}

/** Luma plane (0..255) of an RGBA buffer. */
export function lumaPlane(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) out[p] = luma8(data[i], data[i + 1], data[i + 2]);
  return out;
}

/** Value at a cumulative fraction of a histogram (0..255). */
export function histogramPercentile(hist: Uint32Array, fraction: number): number {
  let total = 0;
  for (let i = 0; i < hist.length; i++) total += hist[i];
  if (total === 0) return 0;
  const target = fraction * total;
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return hist.length - 1;
}

/** Fraction of pixels with luma ≥ threshold (highlight clipping) or ≤ threshold (shadow clipping). */
export function clipFractions(hist: Uint32Array, hi = 250, lo = 5): { highlight: number; shadow: number } {
  let total = 0;
  let h = 0;
  let s = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i];
    if (i >= hi) h += hist[i];
    if (i <= lo) s += hist[i];
  }
  return total ? { highlight: h / total, shadow: s / total } : { highlight: 0, shadow: 0 };
}

/** Dynamic range in stops between two gamma-encoded luma values. */
export function dynamicRangeStops(lo8: number, hi8: number): number {
  const lo = Math.max(SRGB_TO_LINEAR[Math.max(0, Math.min(255, lo8))], 1 / 1024);
  const hi = Math.max(SRGB_TO_LINEAR[Math.max(0, Math.min(255, hi8))], lo);
  return Math.log2(hi / lo);
}

/** RGB (0..255) → hue (0..360), saturation (0..1), value (0..1). */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max / 255];
}

/**
 * Dominant hue using a 36-bin saturation-weighted hue histogram.
 * Returns null when fewer than 10% of pixels carry meaningful colour.
 */
export function dominantHue(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { hue: number | null; meanSaturation: number } {
  const bins = new Float64Array(36);
  let satSum = 0;
  let colourful = 0;
  const n = width * height;
  for (let i = 0; i < n * 4; i += 4) {
    const [h, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
    satSum += s;
    if (s > 0.2 && v > 0.15) {
      bins[Math.min(35, (h / 10) | 0)] += s;
      colourful++;
    }
  }
  const meanSaturation = n ? satSum / n : 0;
  if (colourful < n * 0.1) return { hue: null, meanSaturation };
  let best = 0;
  for (let i = 1; i < 36; i++) if (bins[i] > bins[best]) best = i;
  return { hue: best * 10 + 5, meanSaturation };
}

/** Approximate CCT from linear sRGB via XYZ → xy and McCamy's formula, clamped to 1500..15000 K. */
export function rgbToCct(rLin: number, gLin: number, bLin: number): number {
  const X = 0.4124 * rLin + 0.3576 * gLin + 0.1805 * bLin;
  const Y = 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
  const Z = 0.0193 * rLin + 0.1192 * gLin + 0.9505 * bLin;
  const sum = X + Y + Z;
  if (sum <= 0) return 6500;
  const x = X / sum;
  const y = Y / sum;
  const n = (x - 0.332) / (0.1858 - y);
  const cct = 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33;
  return Math.round(Math.max(1500, Math.min(15000, cct)));
}

/**
 * Gray-world white-balance estimate over mid-tone, not-too-saturated pixels.
 * The average scene is assumed neutral; the residual colour approximates the illuminant.
 */
export function estimateWhiteBalance(data: Uint8ClampedArray, width: number, height: number): WhiteBalanceEstimate {
  let rs = 0;
  let gs = 0;
  let bs = 0;
  let count = 0;
  const n = width * height * 4;
  for (let i = 0; i < n; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 20 || max > 245) continue; // skip black and clipped
    if (max - min > 0.6 * max) continue; // skip highly saturated objects
    rs += SRGB_TO_LINEAR[r];
    gs += SRGB_TO_LINEAR[g];
    bs += SRGB_TO_LINEAR[b];
    count++;
  }
  if (count < 16) return { r: 0.5, g: 0.5, b: 0.5, cct: 6500, tint: 0 };
  const r = rs / count;
  const g = gs / count;
  const b = bs / count;
  const tint = Math.max(-1, Math.min(1, (g - (r + b) / 2) / Math.max(g, 1e-4)));
  return { r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(b), cct: rgbToCct(r, g, b), tint };
}

/** Mean absolute luma difference between two frames, 0..1. Different-size frames → 0. */
export function motionScore(prev: Uint8Array | null, curr: Uint8Array): number {
  if (!prev || prev.length !== curr.length || curr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < curr.length; i++) sum += Math.abs(curr[i] - prev[i]);
  return sum / curr.length / 255;
}

/** Sobel gradient magnitude (0..~1442 max) per pixel; border pixels are 0. */
export function sobelMagnitude(luma: Uint8Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const tl = luma[i - width - 1];
      const t = luma[i - width];
      const tr = luma[i - width + 1];
      const l = luma[i - 1];
      const r = luma[i + 1];
      const bl = luma[i + width - 1];
      const b = luma[i + width];
      const br = luma[i + width + 1];
      const gx = tr + 2 * r + br - tl - 2 * l - bl;
      const gy = bl + 2 * b + br - tl - 2 * t - tr;
      out[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

/** Variance of the 4-neighbour Laplacian inside a rectangle — a classic focus measure. */
export function laplacianVariance(
  luma: Uint8Array,
  width: number,
  height: number,
  rect = { x0: 0, y0: 0, x1: width, y1: height },
): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  const x0 = Math.max(1, rect.x0);
  const y0 = Math.max(1, rect.y0);
  const x1 = Math.min(width - 1, rect.x1);
  const y1 = Math.min(height - 1, rect.y1);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x;
      const lap = luma[i - 1] + luma[i + 1] + luma[i - width] + luma[i + width] - 4 * luma[i];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * Focus-peaking mask: 255 where the gradient exceeds a threshold relative to
 * the frame's strongest edges (top ~8%), else 0.
 */
export function focusPeakingMask(luma: Uint8Array, width: number, height: number, sensitivity = 0.5): Uint8Array {
  const mag = sobelMagnitude(luma, width, height);
  let max = 0;
  for (let i = 0; i < mag.length; i++) if (mag[i] > max) max = mag[i];
  const out = new Uint8Array(width * height);
  if (max < 40) return out; // flat/blurred frame: nothing is in focus enough to peak
  const threshold = Math.max(60, max * (0.55 - 0.35 * Math.max(0, Math.min(1, sensitivity))));
  for (let i = 0; i < mag.length; i++) if (mag[i] >= threshold) out[i] = 255;
  return out;
}

/** Zebra mask: 255 where luma ≥ threshold (0..255). */
export function zebraMask(data: Uint8ClampedArray, width: number, height: number, threshold = 242): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    if (luma8(data[i], data[i + 1], data[i + 2]) >= threshold) out[p] = 255;
  }
  return out;
}

/** Shadow clipping mask: 255 where luma ≤ threshold. */
export function shadowClipMask(data: Uint8ClampedArray, width: number, height: number, threshold = 4): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    if (luma8(data[i], data[i + 1], data[i + 2]) <= threshold) out[p] = 255;
  }
  return out;
}

/** Mean linear luminance of a normalized rectangle (0..1 coordinates). */
export function regionLinear(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  rect: { x: number; y: number; width: number; height: number },
): number {
  const x0 = Math.max(0, Math.floor(rect.x * width));
  const y0 = Math.max(0, Math.floor(rect.y * height));
  const x1 = Math.min(width, Math.ceil((rect.x + rect.width) * width));
  const y1 = Math.min(height, Math.ceil((rect.y + rect.height) * height));
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      sum += SRGB_TO_LINEAR[luma8(data[i], data[i + 1], data[i + 2])];
      n++;
    }
  }
  return n ? sum / n : 0;
}

/** Edge density and fraction of strong edges that are horizontal/vertical (architecture cue). */
export function edgeStructure(
  luma: Uint8Array,
  width: number,
  height: number,
): { density: number; rectilinearity: number } {
  let magSum = 0;
  let strong = 0;
  let aligned = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const gx = luma[i + 1] - luma[i - 1];
      const gy = luma[i + width] - luma[i - width];
      const mag = Math.sqrt(gx * gx + gy * gy);
      magSum += mag;
      n++;
      if (mag > 40) {
        strong++;
        const ax = Math.abs(gx);
        const ay = Math.abs(gy);
        // within ~15° of an axis
        if (ax > 3.7 * ay || ay > 3.7 * ax) aligned++;
      }
    }
  }
  return { density: n ? magSum / n / 255 : 0, rectilinearity: strong > 20 ? aligned / strong : 0 };
}

/** Full statistics for a frame. */
export function analyzeFrame(data: Uint8ClampedArray, width: number, height: number): FrameStats {
  const histograms = computeHistograms(data, width, height);
  const luma = lumaPlane(data, width, height);
  const n = width * height;

  let lumaSum = 0;
  let linSum = 0;
  let cwSum = 0;
  let cwWeight = 0;
  let centerSum = 0;
  let centerN = 0;
  let edgeSum = 0;
  let edgeN = 0;
  let topSum = 0;
  let topN = 0;
  let bottomSum = 0;
  let bottomN = 0;
  let sky = 0;
  let skyN = 0;
  let warm = 0;
  let paper = 0;
  for (let y = 0; y < height; y++) {
    const fy = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const i = p * 4;
      const l = luma[p];
      const lin = SRGB_TO_LINEAR[l];
      lumaSum += l;
      linSum += lin;
      const fx = (x + 0.5) / width;
      const central = fx > 0.25 && fx < 0.75 && fy > 0.25 && fy < 0.75;
      const w = central ? 3 : 1;
      cwSum += lin * w;
      cwWeight += w;
      if (central) {
        centerSum += lin;
        centerN++;
      } else if (fx < 0.15 || fx > 0.85 || fy < 0.15 || fy > 0.85) {
        edgeSum += lin;
        edgeN++;
      }
      if (fy < 0.5) {
        topSum += lin;
        topN++;
      } else {
        bottomSum += lin;
        bottomN++;
      }
      const [h, s, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      if (fy < 1 / 3) {
        skyN++;
        if (h >= 185 && h <= 245 && s > 0.15 && v > 0.45) sky++;
      }
      if ((h <= 45 || h >= 345) && s > 0.35 && v > 0.25) warm++;
      if (s < 0.12 && v > 0.7) paper++;
    }
  }

  const clip = clipFractions(histograms.luma);
  const p01 = histogramPercentile(histograms.luma, 0.01);
  const p50 = histogramPercentile(histograms.luma, 0.5);
  const p99 = histogramPercentile(histograms.luma, 0.99);
  const { hue, meanSaturation } = dominantHue(data, width, height);
  const edges = edgeStructure(luma, width, height);
  const cx0 = Math.floor(width * 0.3);
  const cy0 = Math.floor(height * 0.3);
  const cx1 = Math.ceil(width * 0.7);
  const cy1 = Math.ceil(height * 0.7);
  const centerSharpness = laplacianVariance(luma, width, height, { x0: cx0, y0: cy0, x1: cx1, y1: cy1 });
  const fullSharp = laplacianVariance(luma, width, height);
  // Border band sharpness: average of four strips.
  const bw = Math.max(3, Math.floor(width * 0.15));
  const bh = Math.max(3, Math.floor(height * 0.15));
  const edgeSharpness =
    (laplacianVariance(luma, width, height, { x0: 0, y0: 0, x1: width, y1: bh }) +
      laplacianVariance(luma, width, height, { x0: 0, y0: height - bh, x1: width, y1: height }) +
      laplacianVariance(luma, width, height, { x0: 0, y0: 0, x1: bw, y1: height }) +
      laplacianVariance(luma, width, height, { x0: width - bw, y0: 0, x1: width, y1: height })) /
    4;

  return {
    width,
    height,
    histograms,
    meanLuma: n ? lumaSum / n / 255 : 0,
    meanLinear: n ? linSum / n : 0,
    centerWeightedLinear: cwWeight ? cwSum / cwWeight : 0,
    centerLinear: centerN ? centerSum / centerN : 0,
    edgeLinear: edgeN ? edgeSum / edgeN : 0,
    topLinear: topN ? topSum / topN : 0,
    bottomLinear: bottomN ? bottomSum / bottomN : 0,
    highlightClip: clip.highlight,
    shadowClip: clip.shadow,
    dynamicRange: dynamicRangeStops(p01, p99),
    p01,
    p50,
    p99,
    dominantHue: hue,
    meanSaturation,
    skyFraction: skyN ? sky / skyN : 0,
    warmFraction: n ? warm / n : 0,
    paperFraction: n ? paper / n : 0,
    whiteBalance: estimateWhiteBalance(data, width, height),
    edgeDensity: edges.density,
    rectilinearity: edges.rectilinearity,
    sharpness: fullSharp,
    centerSharpness,
    edgeSharpness,
  };
}
