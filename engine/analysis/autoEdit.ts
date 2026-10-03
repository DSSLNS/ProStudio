/**
 * Auto Edit: analyses the image and proposes adjustments. This is a deterministic
 * image-statistics algorithm (histogram percentiles, clipping, grey-world white
 * balance, noise estimate, skin-tone heuristic) — not a neural network.
 */
import { clamp, linearToSrgb, rgbToHsv, srgbToLinear, whiteBalanceGains } from "@/engine/color/math";

export interface AutoEditChange {
  section: "light" | "color" | "detail";
  key: string;
  label: string;
  value: number;
  unit?: string;
}

export interface AutoEditProposal {
  changes: AutoEditChange[];
  notes: string[];
  stats: {
    median: number;
    p1: number;
    p99: number;
    clipHigh: number;
    clipLow: number;
    meanSat: number;
    noise: number;
    skinFraction: number;
  };
}

export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function percentile(hist: Uint32Array, total: number, p: number): number {
  const target = total * p;
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc >= target) return i / (hist.length - 1);
  }
  return 1;
}

/** Robust noise sigma estimate (Immerkær's fast method) on luma, 0..1 units. */
export function estimateNoise(px: PixelBuffer): number {
  const { data, width: w, height: h } = px;
  if (w < 3 || h < 3) return 0;
  const L = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  };
  let sum = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const v =
        L(x - 1, y - 1) -
        2 * L(x, y - 1) +
        L(x + 1, y - 1) -
        2 * L(x - 1, y) +
        4 * L(x, y) -
        2 * L(x + 1, y) +
        L(x - 1, y + 1) -
        2 * L(x, y + 1) +
        L(x + 1, y + 1);
      sum += Math.abs(v);
    }
  }
  return (sum * Math.sqrt(Math.PI / 2)) / (6 * (w - 2) * (h - 2));
}

/** Find temperature/tint slider values that neutralise the given average linear RGB. */
export function neutraliseWhiteBalance(avg: [number, number, number]): { temperature: number; tint: number } {
  let best = { t: 0, err: Infinity };
  for (let t = -100; t <= 100; t += 1) {
    const g = whiteBalanceGains(t, 0);
    const err = Math.abs(Math.log((avg[0] * g[0]) / (avg[2] * g[2])));
    if (err < best.err) best = { t, err };
  }
  let bestTint = { v: 0, err: Infinity };
  for (let v = -100; v <= 100; v += 1) {
    const g = whiteBalanceGains(best.t, v);
    const r = avg[0] * g[0];
    const gg = avg[1] * g[1];
    const b = avg[2] * g[2];
    const err = Math.abs(Math.log(gg / ((r + b) / 2)));
    if (err < bestTint.err) bestTint = { v, err };
  }
  return { temperature: best.t, tint: bestTint.v };
}

/**
 * @param overview  downscaled whole image (~256px) for global statistics
 * @param detail    a 1:1 crop of the preview (for noise estimation)
 */
export function analyseForAutoEdit(overview: PixelBuffer, detail: PixelBuffer | null): AutoEditProposal {
  const hist = new Uint32Array(256);
  let n = 0;
  let satSum = 0;
  let skin = 0;
  const neutral = [0, 0, 0];
  let neutralCount = 0;
  const d = overview.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    hist[Math.round(y * 255)]++;
    n++;
    const [h, s] = rgbToHsv([r, g, b]);
    satSum += s;
    // YCbCr skin-tone rule of thumb (Chai & Ngan), tolerant across skin types.
    const cb = 128 - 37.797 * r - 74.203 * g + 112 * b;
    const cr = 128 + 112 * r - 93.786 * g - 18.214 * b;
    if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 && y > 0.15) skin++;
    if (y > 0.15 && y < 0.9 && s < 0.25 && !(h > 10 && h < 50 && s > 0.15)) {
      neutral[0] += srgbToLinear(r);
      neutral[1] += srgbToLinear(g);
      neutral[2] += srgbToLinear(b);
      neutralCount++;
    }
  }
  if (!n)
    return {
      changes: [],
      notes: ["The image has no opaque pixels to analyse."],
      stats: { median: 0, p1: 0, p99: 0, clipHigh: 0, clipLow: 0, meanSat: 0, noise: 0, skinFraction: 0 },
    };

  const p1 = percentile(hist, n, 0.01);
  const p5 = percentile(hist, n, 0.05);
  const p50 = percentile(hist, n, 0.5);
  const p95 = percentile(hist, n, 0.95);
  const p99 = percentile(hist, n, 0.99);
  let mean = 0;
  let clipHigh = 0;
  let clipLow = 0;
  for (let i = 0; i < 256; i++) {
    mean += (i / 255) * hist[i];
    if (i >= 251) clipHigh += hist[i];
    if (i <= 4) clipLow += hist[i];
  }
  mean /= n;
  clipHigh /= n;
  clipLow /= n;
  let variance = 0;
  for (let i = 0; i < 256; i++) variance += hist[i] * (i / 255 - mean) ** 2;
  const std = Math.sqrt(variance / n);
  const meanSat = satSum / n;
  const skinFraction = skin / n;
  const noise = detail ? estimateNoise(detail) : 0;

  const changes: AutoEditChange[] = [];
  const notes: string[] = [];
  const add = (c: AutoEditChange) => {
    if (Math.abs(c.value) >= (c.key === "exposure" ? 0.05 : 2)) changes.push(c);
  };

  // Exposure toward a pleasing median, protecting highlights.
  let ev = Math.log2(srgbToLinear(0.46) / Math.max(srgbToLinear(p50), 1e-4)) * 0.7;
  if (ev > 0) ev = Math.min(ev, Math.log2(srgbToLinear(0.97) / Math.max(srgbToLinear(p95), 1e-4)));
  ev = clamp(ev, -1.5, 1.5);
  add({ section: "light", key: "exposure", label: "Exposure", value: Math.round(ev * 100) / 100, unit: "EV" });
  const p99After = linearToSrgb(srgbToLinear(p99) * 2 ** ev);
  const p5After = linearToSrgb(srgbToLinear(p5) * 2 ** ev);

  if (clipHigh > 0.005 || p99After > 0.95) {
    add({
      section: "light",
      key: "highlights",
      label: "Highlights",
      value: -Math.round(clamp((p99After - 0.88) * 500 + clipHigh * 800, 10, 70)),
    });
    if (clipHigh > 0.01)
      notes.push(
        `${(clipHigh * 100).toFixed(1)}% of pixels are clipped highlights; detail there cannot be fully recovered from a non-RAW file.`,
      );
  }
  if (p5After < 0.08 && mean < 0.55)
    add({
      section: "light",
      key: "shadows",
      label: "Shadows",
      value: Math.round(clamp((0.12 - p5After) * 450, 5, 55)),
    });
  if (p99After < 0.88)
    add({ section: "light", key: "whites", label: "Whites", value: Math.round(clamp((0.95 - p99After) * 160, 0, 40)) });
  if (p1 > 0.06)
    add({ section: "light", key: "blacks", label: "Blacks", value: -Math.round(clamp((p1 - 0.03) * 300, 0, 40)) });
  add({ section: "light", key: "contrast", label: "Contrast", value: Math.round(clamp((0.21 - std) * 150, -15, 25)) });

  if (neutralCount > n * 0.02) {
    const avg: [number, number, number] = [
      neutral[0] / neutralCount,
      neutral[1] / neutralCount,
      neutral[2] / neutralCount,
    ];
    const wb = neutraliseWhiteBalance(avg);
    // Only partially correct: strong casts are often intentional (sunsets, tungsten mood).
    add({
      section: "color",
      key: "temperature",
      label: "Temperature",
      value: Math.round(clamp(wb.temperature * 0.6, -40, 40)),
    });
    add({ section: "color", key: "tint", label: "Tint", value: Math.round(clamp(wb.tint * 0.6, -30, 30)) });
  } else {
    notes.push("No neutral areas found; white balance left unchanged.");
  }

  const skinHeavy = skinFraction > 0.08;
  if (skinHeavy) notes.push("Skin tones detected (heuristic) — saturation boost kept gentle and sharpening avoided.");
  if (meanSat < 0.3)
    add({
      section: "color",
      key: "vibrance",
      label: "Vibrance",
      value: Math.round(clamp((0.32 - meanSat) * 90, 0, skinHeavy ? 12 : 25)),
    });

  const noiseLevel = noise * 255;
  if (noiseLevel > 2) {
    add({
      section: "detail",
      key: "noiseLuminance",
      label: "Noise Reduction",
      value: Math.round(clamp((noiseLevel - 1.5) * 8, 5, 45)),
    });
    add({
      section: "detail",
      key: "noiseColor",
      label: "Color Noise Reduction",
      value: Math.round(clamp((noiseLevel - 1) * 10, 10, 50)),
    });
  } else if (!skinHeavy) {
    add({ section: "detail", key: "sharpenAmount", label: "Sharpening", value: 25 });
  }
  if (!changes.length) notes.push("The image is already well balanced; no changes proposed.");
  return {
    changes,
    notes,
    stats: { median: p50, p1, p99, clipHigh, clipLow, meanSat, noise: noiseLevel, skinFraction },
  };
}

/**
 * AI-assisted refinement: re-target exposure on the detected subject (from a
 * segmentation model) instead of the whole frame, keeping highlight protection
 * from the global proposal. Pure; returns a new proposal.
 */
export function applySubjectExposure(p: AutoEditProposal, subjectMedian: number, coverage: number): AutoEditProposal {
  const evSubject = Math.log2(srgbToLinear(0.45) / Math.max(srgbToLinear(subjectMedian), 1e-4)) * 0.7;
  const global = p.changes.find((c) => c.key === "exposure")?.value ?? 0;
  const highlightCap = p.stats.p99 > 0 ? Math.log2(srgbToLinear(0.98) / Math.max(srgbToLinear(p.stats.p99), 1e-4)) : 1.5;
  const ev = Math.round(clamp(Math.min(0.6 * evSubject + 0.4 * global, Math.max(global, highlightCap)), -1.5, 1.5) * 100) / 100;
  const changes = p.changes.filter((c) => c.key !== "exposure");
  if (Math.abs(ev) >= 0.05) changes.unshift({ section: "light", key: "exposure", label: "Exposure", value: ev, unit: "EV" });
  return {
    ...p,
    changes,
    notes: [`AI subject detection: the main subject covers ${Math.round(coverage * 100)}% of the frame; exposure is tuned for it.`, ...p.notes],
  };
}
