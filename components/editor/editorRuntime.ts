import { AssetCache } from "@/engine/layers/assetCache";
import type { View } from "@/engine/layers/view";
import { getAsset } from "@/storage/assets";

/**
 * Imperative handles to the live preview canvas (outside React state so that
 * rendering never triggers re-renders).
 */
export interface EditorRuntime {
  canvas: HTMLCanvasElement | null;
  /** Decoded layer/mask assets shared by preview renders and tools. */
  assets: AssetCache;
  /** Frame-space window shown by the last preview render (null before the first render). */
  view: View | null;
  /** Ask the preview to re-render (e.g. after assets finished loading). */
  requestRender: () => void;
  /** Small JPEG of the current edited preview (for project thumbnails). */
  renderThumbnail: () => Promise<Blob | null>;
  /** Edited preview pixel colour at render-pixel coordinates. */
  readColor: (x: number, y: number) => [number, number, number] | null;
  /** Histogram (256 bins × R,G,B,L) of the current edited preview. */
  histogram: () => Uint32Array | null;
}

// Persistent 1×1 canvas reused by readColor — avoids allocating a new element on every pointermove.
let colorCanvas: HTMLCanvasElement | null = null;
let colorCtx: CanvasRenderingContext2D | null = null;

// Persistent canvas for histogram computation — reused across render frames.
let histCanvas: HTMLCanvasElement | null = null;
let histCtx: CanvasRenderingContext2D | null = null;
let histW = 0;
let histH = 0;

export const editorRuntime: EditorRuntime = {
  canvas: null,
  assets: new AssetCache(async (id) => (await getAsset(id))?.blob),
  view: null,
  requestRender: () => undefined,
  async renderThumbnail() {
    const c = editorRuntime.canvas;
    if (!c || !c.width) return null;
    const s = 480 / Math.max(c.width, c.height);
    const t = document.createElement("canvas");
    t.width = Math.max(1, Math.round(c.width * Math.min(1, s)));
    t.height = Math.max(1, Math.round(c.height * Math.min(1, s)));
    const ctx = t.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(c, 0, 0, t.width, t.height);
    return new Promise((r) => t.toBlob(r, "image/jpeg", 0.82));
  },
  readColor(x, y) {
    const c = editorRuntime.canvas;
    if (!c) return null;
    if (!colorCanvas) {
      colorCanvas = document.createElement("canvas");
      colorCanvas.width = 1;
      colorCanvas.height = 1;
      colorCtx = colorCanvas.getContext("2d", { willReadFrequently: true });
    }
    if (!colorCtx) return null;
    colorCtx.drawImage(c, Math.floor(x), Math.floor(y), 1, 1, 0, 0, 1, 1);
    const d = colorCtx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  },
  histogram() {
    const c = editorRuntime.canvas;
    if (!c || !c.width) return null;
    const s = Math.min(1, 320 / Math.max(c.width, c.height));
    const w = Math.max(1, Math.round(c.width * s));
    const h = Math.max(1, Math.round(c.height * s));
    if (!histCanvas || histW !== w || histH !== h) {
      histCanvas = document.createElement("canvas");
      histCanvas.width = w;
      histCanvas.height = h;
      histCtx = histCanvas.getContext("2d", { willReadFrequently: true });
      histW = w;
      histH = h;
    }
    if (!histCtx) return null;
    histCtx.drawImage(c, 0, 0, w, h);
    const d = histCtx.getImageData(0, 0, w, h).data;
    const bins = new Uint32Array(256 * 4);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      bins[d[i]]++;
      bins[256 + d[i + 1]]++;
      bins[512 + d[i + 2]]++;
      bins[768 + Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++;
    }
    return bins;
  },
};
