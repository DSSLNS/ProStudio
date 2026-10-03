/**
 * Real multi-frame processing (pure, testable):
 *  - Night: translational alignment on downsampled luma + averaging of N
 *    frames (noise falls roughly with √N).
 *  - HDR: single-scale exposure fusion of a bracketed set (Mertens-style
 *    well-exposedness × saturation weights).
 */

export interface RgbaFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Shift {
  dx: number;
  dy: number;
}

/** Box-downsample to a luma plane (Float32, 0..255) by an integer factor. */
export function downsampleLuma(
  frame: RgbaFrame,
  factor: number,
): { luma: Float32Array; width: number; height: number } {
  const f = Math.max(1, Math.floor(factor));
  const w = Math.max(1, Math.floor(frame.width / f));
  const h = Math.max(1, Math.floor(frame.height / f));
  const out = new Float32Array(w * h);
  const { data, width } = frame;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let yy = 0; yy < f; yy++) {
        let i = ((y * f + yy) * width + x * f) * 4;
        for (let xx = 0; xx < f; xx++, i += 4) sum += data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      }
      out[y * w + x] = sum / (f * f);
    }
  }
  return { luma: out, width: w, height: h };
}

/**
 * Exhaustive translational search minimising mean absolute difference over the
 * overlapping area. Returns the shift (in the plane's pixels) that maps `cur`
 * onto `ref`: ref(x, y) ≈ cur(x + dx, y + dy).
 */
export function estimateShift(
  ref: Float32Array,
  cur: Float32Array,
  width: number,
  height: number,
  maxShift: number,
): Shift {
  let best: Shift = { dx: 0, dy: 0 };
  let bestCost = Infinity;
  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      const x0 = Math.max(0, -dx);
      const x1 = Math.min(width, width - dx);
      const y0 = Math.max(0, -dy);
      const y1 = Math.min(height, height - dy);
      if (x1 - x0 < width / 2 || y1 - y0 < height / 2) continue;
      let cost = 0;
      for (let y = y0; y < y1; y++) {
        const ro = y * width;
        const co = (y + dy) * width + dx;
        for (let x = x0; x < x1; x++) cost += Math.abs(ref[ro + x] - cur[co + x]);
      }
      cost /= (x1 - x0) * (y1 - y0);
      // Prefer smaller shifts on ties to avoid drift on flat frames.
      if (
        cost < bestCost - 1e-6 ||
        (Math.abs(cost - bestCost) <= 1e-6 && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))
      ) {
        bestCost = cost;
        best = { dx, dy };
      }
    }
  }
  return best;
}

/** Coarse-to-fine alignment of each frame to frames[0], in full-resolution pixels. */
export function alignFrames(frames: RgbaFrame[], maxShiftFullRes = 48): Shift[] {
  if (frames.length === 0) return [];
  const factor = Math.max(1, Math.floor(Math.max(frames[0].width, frames[0].height) / 320));
  const ref = downsampleLuma(frames[0], factor);
  const maxShift = Math.max(1, Math.ceil(maxShiftFullRes / factor));
  return frames.map((f, i) => {
    if (i === 0) return { dx: 0, dy: 0 };
    const cur = downsampleLuma(f, factor);
    const s = estimateShift(ref.luma, cur.luma, ref.width, ref.height, maxShift);
    return { dx: s.dx * factor, dy: s.dy * factor };
  });
}

/**
 * Average aligned frames. Sums are accumulated exactly in Uint16 (≤ 257 frames)
 * with a per-pixel count so borders not covered by every frame are still
 * correctly normalised. Output alpha is opaque.
 */
export function stackFrames(frames: RgbaFrame[], shifts: Shift[]): RgbaFrame {
  const { width, height } = frames[0];
  if (frames.length > 257) throw new Error("Too many frames to stack.");
  const sum = new Uint16Array(width * height * 3);
  const count = new Uint16Array(width * height);
  frames.forEach((f, k) => {
    const { dx, dy } = shifts[k] ?? { dx: 0, dy: 0 };
    for (let y = 0; y < height; y++) {
      const sy = y + dy;
      if (sy < 0 || sy >= height) continue;
      for (let x = 0; x < width; x++) {
        const sx = x + dx;
        if (sx < 0 || sx >= width) continue;
        const si = (sy * width + sx) * 4;
        const p = y * width + x;
        sum[p * 3] += f.data[si];
        sum[p * 3 + 1] += f.data[si + 1];
        sum[p * 3 + 2] += f.data[si + 2];
        count[p]++;
      }
    }
  });
  const out = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const c = count[p] || 1;
    out[p * 4] = sum[p * 3] / c;
    out[p * 4 + 1] = sum[p * 3 + 1] / c;
    out[p * 4 + 2] = sum[p * 3 + 2] / c;
    out[p * 4 + 3] = 255;
  }
  return { data: out, width, height };
}

/** Align + stack in one call. */
export function mergeNightFrames(frames: RgbaFrame[]): RgbaFrame {
  if (frames.length === 0) throw new Error("No frames to merge.");
  if (frames.length === 1) return frames[0];
  return stackFrames(frames, alignFrames(frames));
}

/**
 * Single-scale exposure fusion: per-pixel weights from well-exposedness
 * (Gaussian around mid-grey) × (saturation + ε); weighted average of inputs.
 */
export function exposureFusion(frames: RgbaFrame[]): RgbaFrame {
  if (frames.length === 0) throw new Error("No frames to fuse.");
  const { width, height } = frames[0];
  const out = new Uint8ClampedArray(width * height * 4);
  const sigma2 = 2 * 0.2 * 0.2;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    let wSum = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const f of frames) {
      const fr = f.data[i] / 255;
      const fg = f.data[i + 1] / 255;
      const fb = f.data[i + 2] / 255;
      const we =
        Math.exp(-((fr - 0.5) ** 2) / sigma2) *
        Math.exp(-((fg - 0.5) ** 2) / sigma2) *
        Math.exp(-((fb - 0.5) ** 2) / sigma2);
      const mean = (fr + fg + fb) / 3;
      const sat = Math.sqrt(((fr - mean) ** 2 + (fg - mean) ** 2 + (fb - mean) ** 2) / 3);
      const w = we * (sat + 0.05) + 1e-6;
      wSum += w;
      r += fr * w;
      g += fg * w;
      b += fb * w;
    }
    out[i] = (r / wSum) * 255;
    out[i + 1] = (g / wSum) * 255;
    out[i + 2] = (b / wSum) * 255;
    out[i + 3] = 255;
  }
  return { data: out, width, height };
}
