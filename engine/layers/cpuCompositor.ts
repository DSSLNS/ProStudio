/**
 * CPU layer compositor (fallback when WebGL2 is unavailable or GPU acceleration
 * is disabled). Uses Canvas2D's native implementations of the same W3C blend
 * modes, plus JS adjustment maths. Retouch layers need the GPU and are reported
 * as unsupported rather than silently dropped.
 */
import type { LayerDoc } from "@/types/layers";
import { childrenOf } from "@/types/layers";
import { CANVAS_BLEND } from "./blend";
import { adjustPixel, adjustUniforms, isIdentityAdjustment } from "./adjust";
import {
  drawPaintOp,
  newCanvas,
  rasterizeImageLayer,
  rasterizeMask,
  rasterizeShapeLayer,
  rasterizeTextLayer,
  type AssetSource,
  type Canvas2D,
} from "./raster";
import type { View } from "./view";
import type { Vec3 } from "@/engine/color/math";

export interface CpuCompositeResult {
  canvas: Canvas2D;
  unsupported: string[];
}

function masked(content: Canvas2D, layer: LayerDoc, view: View, assets: AssetSource): Canvas2D {
  if (!layer.mask || !layer.maskEnabled) return content;
  const m = rasterizeMask(layer.mask, view, assets, layer.maskFeather);
  const { canvas, ctx } = newCanvas(view.width, view.height);
  ctx.drawImage(content, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(m, 0, 0);
  return canvas;
}

function drawOnto(accum: Canvas2D, src: Canvas2D, layer: LayerDoc) {
  const ctx = accum.getContext("2d")!;
  ctx.save();
  ctx.globalAlpha = layer.opacity / 100;
  ctx.globalCompositeOperation = CANVAS_BLEND[layer.blendMode];
  ctx.drawImage(src, 0, 0);
  ctx.restore();
}

function adjusted(accum: Canvas2D, layer: Extract<LayerDoc, { kind: "adjustment" }>): Canvas2D {
  const { canvas, ctx } = newCanvas(accum.width, accum.height);
  const img = accum.getContext("2d")!.getImageData(0, 0, accum.width, accum.height);
  const u = adjustUniforms(layer.adjustment);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const c = adjustPixel([d[i] / 255, d[i + 1] / 255, d[i + 2] / 255] as Vec3, u);
    d[i] = Math.round(c[0] * 255);
    d[i + 1] = Math.round(c[1] * 255);
    d[i + 2] = Math.round(c[2] * 255);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function renderLayer(
  layer: LayerDoc,
  accum: Canvas2D,
  all: LayerDoc[],
  view: View,
  assets: AssetSource,
  unsupported: Set<string>,
) {
  if (!layer.visible || layer.opacity <= 0) return;
  let content: Canvas2D | null = null;
  switch (layer.kind) {
    case "image":
      content = rasterizeImageLayer(layer, view, assets);
      break;
    case "text":
      content = rasterizeTextLayer(layer, view);
      break;
    case "shape":
      content = rasterizeShapeLayer(layer, view);
      break;
    case "paint": {
      const { canvas, ctx } = newCanvas(view.width, view.height);
      for (const op of layer.ops) drawPaintOp(ctx, op, view, assets);
      content = canvas;
      break;
    }
    case "adjustment":
      if (isIdentityAdjustment(layer.adjustment)) return;
      content = adjusted(accum, layer);
      break;
    case "group": {
      const { canvas } = newCanvas(view.width, view.height);
      for (const child of childrenOf(all, layer.id)) renderLayer(child, canvas, all, view, assets, unsupported);
      content = canvas;
      break;
    }
    case "retouch":
      if (layer.ops.length) unsupported.add(`Retouch layer “${layer.name}” (requires WebGL2)`);
      return;
    case "base":
      return;
  }
  if (content) drawOnto(accum, masked(content, layer, view, assets), layer);
}

/** Composite layers on top of an already developed base image (straight RGBA, view-sized). */
export function compositeCpu(base: ImageData, layers: LayerDoc[], view: View, assets: AssetSource): CpuCompositeResult {
  const unsupported = new Set<string>();
  const { canvas: accum, ctx } = newCanvas(view.width, view.height);
  const b = layers[0];
  if (b?.kind === "base" && b.visible && b.opacity > 0) {
    const { canvas: baseCanvas, ctx: bc } = newCanvas(view.width, view.height);
    bc.putImageData(base, 0, 0);
    ctx.globalAlpha = b.opacity / 100;
    ctx.drawImage(masked(baseCanvas, b, view, assets), 0, 0);
    ctx.globalAlpha = 1;
  }
  for (const layer of childrenOf(layers, null)) {
    if (layer.kind !== "base") renderLayer(layer, accum, layers, view, assets, unsupported);
  }
  return { canvas: accum, unsupported: [...unsupported] };
}
