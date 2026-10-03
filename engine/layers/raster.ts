/**
 * Canvas2D rasterisers for layer content and masks. Everything is drawn from
 * frame-space descriptions into a View, so the same code produces the preview
 * and full-resolution export tiles. Works in workers (OffscreenCanvas).
 */
import type {
  BrushParams,
  CombineMode,
  ImageLayer,
  MaskDoc,
  MaskOp,
  PaintOp,
  Placement,
  ShapeLayer,
  TextLayer,
} from "@/types/layers";
import { gaussianBlur } from "@/engine/filters/blur";
import { strokeDabs } from "./dabs";
import { applyView, expandView, type View } from "./view";

export type Canvas2D = OffscreenCanvas;
type Ctx = OffscreenCanvasRenderingContext2D;

export interface AssetSource {
  get(id: string): ImageBitmap | undefined;
}

// Canvases mutated in place (incremental painting) carry a version for texture re-upload.
const versions = new WeakMap<Canvas2D, number>();
let versionCounter = 0;
export function canvasVersion(c: Canvas2D): number {
  return versions.get(c) ?? 0;
}
export function bumpCanvasVersion(c: Canvas2D) {
  versions.set(c, ++versionCounter);
}

export function newCanvas(w: number, h: number): { canvas: Canvas2D; ctx: Ctx } {
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const ctx = canvas.getContext("2d", { willReadFrequently: false })!;
  return { canvas, ctx };
}

// --- brush stamps -----------------------------------------------------------

const stampCache = new Map<number, Canvas2D>();
/** White disc with a soft edge controlled by hardness, drawn once and reused. */
export function brushStamp(hardness: number): Canvas2D {
  const key = Math.round(hardness * 20) / 20;
  let s = stampCache.get(key);
  if (s) return s;
  const size = 256;
  const { canvas, ctx } = newCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const inner = Math.min(0.99, key);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(inner, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  s = canvas;
  stampCache.set(key, s);
  return s;
}

/** Draws a stroke's dabs (white coverage) into a fresh canvas the size of the view. */
export function rasterizeStrokeCoverage(points: number[], brush: BrushParams, view: View, aliased = false): Canvas2D {
  const { canvas, ctx } = newCanvas(view.width, view.height);
  const stamp = brushStamp(aliased ? 1 : brush.hardness);
  ctx.imageSmoothingEnabled = !aliased;
  for (const d of strokeDabs(points, brush)) {
    const r = (d.size / 2) * view.scale;
    const x = (d.x - view.originX) * view.scale;
    const y = (d.y - view.originY) * view.scale;
    if (x + r < 0 || y + r < 0 || x - r > view.width || y - r > view.height) continue;
    ctx.globalAlpha = d.flow;
    if (aliased) {
      // Pencil: hard-edged, no anti-aliasing (pixel-snapped disc).
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(Math.round(x), Math.round(y), Math.max(0.5, Math.round(r)), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.drawImage(stamp, x - r, y - r, 2 * r, 2 * r);
    }
  }
  ctx.globalAlpha = 1; // later compositing on this canvas must not inherit the dab flow
  return canvas;
}

// --- masks ------------------------------------------------------------------

/** Frame-px margin a mask needs around a view so blurs/expansions are correct at the edges. */
export function maskMargin(mask: MaskDoc | null, extraFeather = 0): number {
  if (!mask) return 0;
  let m = extraFeather * 3;
  const walk = (d: MaskDoc) => {
    for (const op of d.ops) {
      if (op.type === "feather") m += op.radius * 3;
      if (op.type === "expand") m += Math.abs(op.radius) * 2;
      if (op.type === "mask") walk(op.mask);
    }
  };
  walk(mask);
  return Math.ceil(m);
}

function compositeFor(mode: CombineMode): GlobalCompositeOperation {
  switch (mode) {
    case "subtract":
      return "destination-out";
    case "intersect":
      return "destination-in";
    default:
      return "source-over";
  }
}

/** Composite an op's coverage canvas onto the mask canvas with its combine mode. */
function combine(ctx: Ctx, coverage: Canvas2D, mode: CombineMode, alpha = 1) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (mode === "replace") ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.globalCompositeOperation = compositeFor(mode);
  ctx.globalAlpha = alpha;
  ctx.drawImage(coverage, 0, 0);
  ctx.restore();
}

function shapeCoverage(view: View, draw: (ctx: Ctx) => void): Canvas2D {
  const { canvas, ctx } = newCanvas(view.width, view.height);
  applyView(ctx, view);
  ctx.fillStyle = "#fff";
  draw(ctx);
  return canvas;
}

/** Gaussian blur of the alpha channel in place (CPU; used for feather/expand). */
function blurAlpha(ctx: Ctx, sigmaPx: number) {
  if (sigmaPx < 0.3) return;
  const { width: w, height: h } = ctx.canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = img.data[i * 4 + 3] / 255;
  const b = gaussianBlur(a, w, h, sigmaPx);
  for (let i = 0; i < b.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, b[i])) * 255);
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Expand (r>0) / contract (r<0) by blurring and re-thresholding: produces
 * rounded, smooth offsets that also behave well on soft masks.
 */
function expandAlpha(ctx: Ctx, radiusPx: number) {
  if (Math.abs(radiusPx) < 0.5) return;
  const { width: w, height: h } = ctx.canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = img.data[i * 4 + 3] / 255;
  const b = gaussianBlur(a, w, h, Math.abs(radiusPx) / 2);
  // Gaussian CDF at 2σ ≈ 0.977: threshold moves the 0.5 contour by ~r.
  const t = radiusPx > 0 ? 0.023 : 0.977;
  const soft = 0.02;
  for (let i = 0; i < b.length; i++) {
    const v = Math.max(0, Math.min(1, (b[i] - (t - soft)) / (2 * soft)));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = Math.round(v * 255);
  }
  ctx.putImageData(img, 0, 0);
}

function invertAlpha(ctx: Ctx) {
  const { width: w, height: h } = ctx.canvas;
  const { canvas: t, ctx: tc } = newCanvas(w, h);
  tc.fillStyle = "#fff";
  tc.fillRect(0, 0, w, h);
  tc.globalCompositeOperation = "destination-out";
  tc.drawImage(ctx.canvas, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(t, 0, 0);
  ctx.restore();
}

/** Apply a single mask op to the mask canvas (which covers `view`). */
export function applyMaskOp(ctx: Ctx, op: MaskOp, view: View, assets: AssetSource) {
  switch (op.type) {
    case "rect":
      return combine(
        ctx,
        shapeCoverage(view, (c) => c.fillRect(op.x, op.y, op.w, op.h)),
        op.mode,
      );
    case "ellipse":
      return combine(
        ctx,
        shapeCoverage(view, (c) => {
          c.beginPath();
          c.ellipse(op.cx, op.cy, Math.max(0.01, op.rx), Math.max(0.01, op.ry), 0, 0, Math.PI * 2);
          c.fill();
        }),
        op.mode,
      );
    case "polygon":
      return combine(
        ctx,
        shapeCoverage(view, (c) => {
          c.beginPath();
          for (let i = 0; i + 1 < op.points.length; i += 2) {
            if (i === 0) c.moveTo(op.points[0], op.points[1]);
            else c.lineTo(op.points[i], op.points[i + 1]);
          }
          c.closePath();
          c.fill();
        }),
        op.mode,
      );
    case "stroke": {
      const cov = rasterizeStrokeCoverage(op.points, op.brush, view);
      return combine(ctx, cov, op.mode, op.brush.opacity * op.value);
    }
    case "gradient": {
      const cov = shapeCoverage(view, (c) => {
        const g =
          op.kind === "linear"
            ? c.createLinearGradient(op.x0, op.y0, op.x1, op.y1)
            : c.createRadialGradient(
                op.x0,
                op.y0,
                0,
                op.x0,
                op.y0,
                Math.max(0.01, Math.hypot(op.x1 - op.x0, op.y1 - op.y0)),
              );
        g.addColorStop(0, "rgba(255,255,255,1)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        c.fillStyle = g;
        c.setTransform(1, 0, 0, 1, 0, 0);
        // Gradient defined in frame space; fill the whole canvas through the view transform.
        applyView(c, view);
        c.fillRect(view.originX, view.originY, view.width / view.scale, view.height / view.scale);
      });
      return combine(ctx, cov, op.mode);
    }
    case "raster": {
      const bmp = assets.get(op.assetId);
      if (!bmp) return;
      const cov = shapeCoverage(view, (c) => {
        c.imageSmoothingQuality = "high";
        c.drawImage(bmp, op.x, op.y, op.w, op.h);
      });
      return combine(ctx, cov, op.mode);
    }
    case "mask": {
      const inner = rasterizeMask(op.mask, view, assets);
      return combine(ctx, inner, op.mode);
    }
    case "feather":
      return blurAlpha(ctx, op.radius * view.scale);
    case "expand":
      return expandAlpha(ctx, op.radius * view.scale);
    case "invert":
      return invertAlpha(ctx);
  }
}

/**
 * Rasterise a mask/selection into a canvas covering `view`: alpha = mask value.
 * Renders with an internal margin so feather/expand are correct at view edges.
 */
export function rasterizeMask(mask: MaskDoc, view: View, assets: AssetSource, extraFeather = 0): Canvas2D {
  const margin = maskMargin(mask, extraFeather);
  const { view: big, padPx } = margin > 0 ? expandView(view, margin) : { view, padPx: 0 };
  const { canvas, ctx } = newCanvas(big.width, big.height);
  if (mask.base === 1) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, big.width, big.height);
  }
  for (const op of mask.ops) applyMaskOp(ctx, op, big, assets);
  if (extraFeather > 0) blurAlpha(ctx, extraFeather * view.scale);
  if (padPx === 0) return canvas;
  const { canvas: out, ctx: oc } = newCanvas(view.width, view.height);
  oc.drawImage(canvas, -padPx, -padPx);
  return out;
}

/**
 * Incremental op-list rasteriser shared by masks and paint layers.
 * Ops 0..n-2 are drawn once into a stable canvas; the last op (which changes on
 * every pointer move while a stroke is in progress) is drawn onto a copy. So a
 * live stroke costs one copy + one stroke per frame, regardless of history.
 */
class OpListCache<Op> {
  private entries = new Map<
    string,
    { key: string; base: number; stableOps: Op[]; stable: Canvas2D; out: Canvas2D; outKey: Op | null; outLen: number }
  >();

  get(id: string, base: 0 | 1, ops: Op[], view: View, viewK: string, draw: (ctx: Ctx, op: Op) => void): Canvas2D {
    const stableTarget = ops.slice(0, Math.max(0, ops.length - 1));
    let e = this.entries.get(id);
    const prefixOk =
      e &&
      e.key === viewK &&
      e.base === base &&
      e.stableOps.length <= stableTarget.length &&
      e.stableOps.every((op, i) => op === stableTarget[i]);
    if (!e || !prefixOk) {
      const { canvas: stable, ctx } = newCanvas(view.width, view.height);
      if (base === 1) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, view.width, view.height);
      }
      for (const op of stableTarget) draw(ctx, op);
      e = {
        key: viewK,
        base,
        stableOps: stableTarget,
        stable,
        out: newCanvas(view.width, view.height).canvas,
        outKey: null,
        outLen: -1,
      };
      this.entries.set(id, e);
    } else if (e.stableOps.length < stableTarget.length) {
      const ctx = e.stable.getContext("2d")!;
      for (const op of stableTarget.slice(e.stableOps.length)) draw(ctx, op);
      e.stableOps = stableTarget;
      e.outLen = -1;
    }
    const last = ops.length ? ops[ops.length - 1] : null;
    if (e.outKey !== last || e.outLen !== ops.length) {
      const ctx = e.out.getContext("2d")!;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "copy";
      ctx.drawImage(e.stable, 0, 0);
      ctx.restore();
      if (last) draw(ctx, last);
      e.outKey = last;
      e.outLen = ops.length;
      bumpCanvasVersion(e.out);
    }
    return e.out;
  }

  delete(id: string) {
    this.entries.delete(id);
  }

  clear() {
    this.entries.clear();
  }
}

export class MaskRasterCache {
  private ops = new OpListCache<MaskOp>();
  private full = new Map<string, { mask: MaskDoc; key: string; canvas: Canvas2D }>();
  private feathered = new Map<string, { src: Canvas2D; version: number; f: number; canvas: Canvas2D }>();

  get(id: string, mask: MaskDoc, view: View, viewK: string, assets: AssetSource, feather: number): Canvas2D {
    let canvas: Canvas2D;
    if (maskMargin(mask, 0) > 0) {
      // Feather/expand ops need context beyond the view edges: full rasterisation with margin.
      const f = this.full.get(id);
      if (f && f.mask === mask && f.key === viewK) canvas = f.canvas;
      else {
        canvas = rasterizeMask(mask, view, assets);
        bumpCanvasVersion(canvas);
        this.full.set(id, { mask, key: viewK, canvas });
      }
    } else {
      canvas = this.ops.get(id, mask.base, mask.ops, view, viewK, (ctx, op) => applyMaskOp(ctx, op, view, assets));
    }
    if (feather <= 0) return canvas;
    const v = canvasVersion(canvas);
    const fe = this.feathered.get(id);
    if (fe && fe.src === canvas && fe.version === v && fe.f === feather) return fe.canvas;
    const { canvas: out, ctx } = newCanvas(view.width, view.height);
    ctx.drawImage(canvas, 0, 0);
    blurAlpha(ctx, feather * view.scale);
    bumpCanvasVersion(out);
    this.feathered.set(id, { src: canvas, version: v, f: feather, canvas: out });
    return out;
  }

  clear() {
    this.ops.clear();
    this.full.clear();
    this.feathered.clear();
  }
}

// --- layer content ------------------------------------------------------------

function placementTransform(ctx: Ctx, p: Placement) {
  ctx.translate(p.x, p.y);
  ctx.rotate((p.rotation * Math.PI) / 180);
}

export function rasterizeImageLayer(layer: ImageLayer, view: View, assets: AssetSource): Canvas2D {
  const { canvas, ctx } = newCanvas(view.width, view.height);
  const bmp = assets.get(layer.assetId);
  if (!bmp) return canvas;
  applyView(ctx, view);
  placementTransform(ctx, layer.placement);
  ctx.imageSmoothingQuality = "high";
  const { width: w, height: h } = layer.placement;
  ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
  return canvas;
}

export function textLines(layer: Pick<TextLayer, "text">): string[] {
  return layer.text.split(/\r?\n/);
}

export function fontString(layer: Pick<TextLayer, "fontWeight" | "fontSize" | "fontFamily">): string {
  return `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
}

/** Measure a text block in frame px (used to size the placement box). */
export function measureText(layer: Pick<TextLayer, "text" | "fontWeight" | "fontSize" | "fontFamily">): {
  width: number;
  height: number;
} {
  const { ctx } = newCanvas(1, 1);
  ctx.font = fontString(layer);
  const lines = textLines(layer);
  const width = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  return { width: Math.ceil(width + layer.fontSize * 0.2), height: Math.ceil(lines.length * layer.fontSize * 1.2) };
}

export function rasterizeTextLayer(layer: TextLayer, view: View): Canvas2D {
  const { canvas, ctx } = newCanvas(view.width, view.height);
  applyView(ctx, view);
  placementTransform(ctx, layer.placement);
  ctx.font = fontString(layer);
  ctx.fillStyle = layer.color;
  ctx.textBaseline = "middle";
  ctx.textAlign = layer.align;
  const lines = textLines(layer);
  const lh = layer.fontSize * 1.2;
  const x =
    layer.align === "left" ? -layer.placement.width / 2 : layer.align === "right" ? layer.placement.width / 2 : 0;
  lines.forEach((line, i) => ctx.fillText(line, x, (i - (lines.length - 1) / 2) * lh));
  return canvas;
}

export function rasterizeShapeLayer(layer: ShapeLayer, view: View): Canvas2D {
  const { canvas, ctx } = newCanvas(view.width, view.height);
  applyView(ctx, view);
  placementTransform(ctx, layer.placement);
  const { width: w, height: h } = layer.placement;
  ctx.beginPath();
  if (layer.shape === "ellipse") ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else ctx.rect(-w / 2, -h / 2, w, h);
  if (layer.fill) {
    ctx.fillStyle = layer.fill;
    ctx.fill();
  }
  if (layer.stroke && layer.strokeWidth > 0) {
    ctx.strokeStyle = layer.stroke;
    ctx.lineWidth = layer.strokeWidth;
    ctx.stroke();
  }
  return canvas;
}

/** Draw one paint op onto a paint-layer canvas covering `view`. */
export function drawPaintOp(ctx: Ctx, op: PaintOp, view: View, assets: AssetSource) {
  const cov = rasterizeStrokeCoverage(op.points, op.brush, view, op.tool === "pencil");
  const cc = cov.getContext("2d")!;
  if (op.tool !== "eraser") {
    cc.globalCompositeOperation = "source-in";
    cc.fillStyle = op.color;
    cc.fillRect(0, 0, cov.width, cov.height);
  }
  if (op.clip) {
    const clip = rasterizeMask(op.clip, view, assets);
    cc.globalCompositeOperation = "destination-in";
    cc.drawImage(clip, 0, 0);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = op.tool === "eraser" ? "destination-out" : "source-over";
  ctx.globalAlpha = op.brush.opacity;
  ctx.drawImage(cov, 0, 0);
  ctx.restore();
}

/** Incremental paint-layer rasteriser. */
export class PaintRasterCache {
  private ops = new OpListCache<PaintOp>();

  get(
    id: string,
    ops: PaintOp[],
    view: View,
    viewK: string,
    assets: AssetSource,
  ): { canvas: Canvas2D; version: number } {
    const canvas = this.ops.get(id, 0, ops, view, viewK, (ctx, op) => drawPaintOp(ctx, op, view, assets));
    return { canvas, version: canvasVersion(canvas) };
  }

  clear() {
    this.ops.clear();
  }
}
