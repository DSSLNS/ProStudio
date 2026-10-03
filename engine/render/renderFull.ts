/**
 * Full-resolution, tiled rendering of a recipe from the ORIGINAL source bitmap.
 * Used by export. Never touches the preview. Runs in a worker (OffscreenCanvas)
 * or on the main thread as a fallback.
 *
 * Each output tile is mapped back to the minimal source region it needs (plus a
 * margin covering the largest blur radius), so neither the GPU texture limit nor
 * memory is exceeded by large images.
 */
import { WebGLRenderer, blurRadiiFor, type LutData } from "@/engine/gl/WebGLRenderer";
import { renderCpu } from "@/engine/cpu/CpuRenderer";
import type { EditRecipe } from "@/types/edit";
import {
  effectiveCrop,
  mul,
  orientedSize,
  outputSize,
  outputToSourceMatrix,
  sourceBoundsForOutputRect,
  translate,
} from "@/engine/image/transform";
import { isTrivialStack, needsSinglePass, type LayerDoc } from "@/types/layers";
import { GLCompositor } from "@/engine/gl/Compositor";
import { compositeCpu } from "@/engine/layers/cpuCompositor";
import type { AssetSource } from "@/engine/layers/raster";
import type { View } from "@/engine/layers/view";

export interface FullRenderInput {
  source: ImageBitmap;
  recipe: EditRecipe;
  lut: LutData | null;
  preferGpu: boolean;
  /** Layer stack (index 0 = base). Omitted or trivial → plain develop path. */
  layers?: LayerDoc[];
  assets?: AssetSource;
  onProgress?: (fraction: number, message: string) => void;
}

export interface FullRenderResult {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  usedGpu: boolean;
}

function newCanvas2d(w: number, h: number): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } {
  let canvas: OffscreenCanvas;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  try {
    canvas = new OffscreenCanvas(w, h);
    ctx = canvas.getContext("2d", { alpha: true });
  } catch {
    ctx = null;
  }
  if (!ctx) {
    throw new Error(
      `The output (${w} × ${h}) is larger than this browser can hold in a single canvas. Try exporting a smaller size or use a desktop browser.`,
    );
  }
  return { canvas: canvas!, ctx };
}

const yieldToLoop = () => new Promise<void>((r) => setTimeout(r, 0));

export async function renderFullResolution(input: FullRenderInput): Promise<FullRenderResult> {
  const { source, recipe, lut } = input;
  const srcW = source.width;
  const srcH = source.height;
  const { width: outW, height: outH } = outputSize(srcW, srcH, recipe.geometry);
  const { canvas: out, ctx: outCtx } = newCanvas2d(outW, outH);
  const radii = blurRadiiFor(recipe, srcW, srcH, 1);
  const margin = Math.ceil(radii.large * 3 + 8);
  const fullM = outputToSourceMatrix(srcW, srcH, recipe.geometry, outW, outH);

  let gpu: WebGLRenderer | null = null;
  if (input.preferGpu) {
    try {
      gpu = WebGLRenderer.create(new OffscreenCanvas(1, 1));
      gpu?.setLut(lut);
    } catch {
      gpu = null;
    }
  }
  let tile = gpu ? Math.min(2048, Math.floor(gpu.maxTextureSize / 2)) : 1024;
  const maxRegion = gpu ? gpu.maxTextureSize : 8192;

  const layers = input.layers && !isTrivialStack(input.layers) ? input.layers : null;
  const assets: AssetSource = input.assets ?? { get: () => undefined };
  const compositor = layers && gpu ? new GLCompositor(gpu) : null;
  // Layer views are in frame px; at export 1 output px = 1 frame px, offset by the crop origin.
  const frame = orientedSize(srcW, srcH, recipe.geometry);
  const crop = effectiveCrop(recipe.geometry);
  const frameOriginX = crop.x * frame.width;
  const frameOriginY = crop.y * frame.height;
  if (layers && needsSinglePass(layers)) {
    // Retouch operations can sample anywhere in the image, so render in one pass.
    if (!gpu) throw new Error("Retouch layers require GPU rendering (WebGL2), which is not available for this export.");
    if (outW > gpu.maxTextureSize || outH > gpu.maxTextureSize) {
      throw new Error(
        `This image (${outW} × ${outH}) exceeds this device's GPU limit (${gpu.maxTextureSize}px) for exporting retouch layers.`,
      );
    }
    tile = Math.max(outW, outH);
  }

  try {
    const tilesX = () => Math.ceil(outW / tile);
    const tilesY = () => Math.ceil(outH / tile);
    // Shrink tiles if a tile's source footprint would exceed the texture limit (e.g. strong scale/perspective).
    for (;;) {
      const probe = sourceBoundsForOutputRect(
        fullM,
        { x: 0, y: 0, width: Math.min(tile, outW), height: Math.min(tile, outH) },
        srcW,
        srcH,
        margin,
      );
      const big = probe && (probe.width > maxRegion || probe.height > maxRegion);
      if (!big || tile <= 256 || (layers && needsSinglePass(layers))) break;
      tile = Math.floor(tile / 2);
    }
    const total = tilesX() * tilesY();
    let done = 0;
    for (let ty = 0; ty < outH; ty += tile) {
      for (let tx = 0; tx < outW; tx += tile) {
        const tw = Math.min(tile, outW - tx);
        const th = Math.min(tile, outH - ty);
        const region = sourceBoundsForOutputRect(fullM, { x: tx, y: ty, width: tw, height: th }, srcW, srcH, margin);
        done++;
        input.onProgress?.(done / total, `Rendering tile ${done} of ${total}`);
        if (!region) continue; // tile lies entirely outside the image (transparent)
        const regionBmp = await createImageBitmap(source, region.x, region.y, region.width, region.height, {
          premultiplyAlpha: "none",
          colorSpaceConversion: "none",
        });
        // Tile-local matrix: render pixel → full output pixel (via tileOffset in shader) → region pixel.
        const m = mul(translate(-region.x, -region.y), fullM);
        let tileData: ImageData;
        const view: View = { originX: frameOriginX + tx, originY: frameOriginY + ty, scale: 1, width: tw, height: th };
        if (gpu && compositor && layers) {
          gpu.setSource(regionBmp, region.width, region.height);
          compositor.clearCaches();
          const result = compositor.composite({
            develop: { recipe, outToSrc: m, radii, tileOffset: [tx, ty], fullSize: [outW, outH], grainScale: 1 },
            layers,
            view,
            assets,
          });
          const out8 = gpu.createTarget8(tw, th);
          compositor.present(result, { into: out8, unpremultiply: true });
          tileData = new ImageData(gpu.readTarget(out8), tw, th);
          gpu.releaseTarget(out8);
          compositor.release(result);
        } else if (gpu) {
          gpu.setSource(regionBmp, region.width, region.height);
          gpu.render({
            recipe,
            width: tw,
            height: th,
            outToSrc: m,
            radii,
            tileOffset: [tx, ty],
            fullSize: [outW, outH],
            grainScale: 1,
            premultiply: false,
          });
          tileData = new ImageData(gpu.readPixels(tw, th), tw, th);
        } else {
          const c = new OffscreenCanvas(region.width, region.height);
          const cx = c.getContext("2d")!;
          cx.drawImage(regionBmp, 0, 0);
          const px = cx.getImageData(0, 0, region.width, region.height);
          tileData = renderCpu(
            { data: px.data, width: region.width, height: region.height },
            {
              recipe,
              width: tw,
              height: th,
              outToSrc: m,
              radii,
              lut,
              tileOffset: [tx, ty],
              fullSize: [outW, outH],
              grainScale: 1,
            },
          );
          if (layers) {
            const res = compositeCpu(tileData, layers, view, assets);
            if (res.unsupported.length) throw new Error(`Cannot export without GPU: ${res.unsupported.join(", ")}.`);
            tileData = res.canvas.getContext("2d")!.getImageData(0, 0, tw, th);
          }
        }
        regionBmp.close();
        outCtx.putImageData(tileData, tx, ty);
        await yieldToLoop();
      }
    }
  } finally {
    compositor?.dispose();
    gpu?.dispose();
  }
  return { canvas: out, width: outW, height: outH, usedGpu: !!gpu };
}

/**
 * High-quality resize by successive halving then a final bilinear step
 * (avoids the aliasing of a single large downscale). Only used when the user
 * explicitly chooses an export size.
 */
export function resizeCanvas(src: OffscreenCanvas, w: number, h: number): OffscreenCanvas {
  if (src.width === w && src.height === h) return src;
  let cur: OffscreenCanvas = src;
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const next = new OffscreenCanvas(Math.round(cur.width / 2), Math.round(cur.height / 2));
    const ctx = next.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  const out = new OffscreenCanvas(w, h);
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cur, 0, 0, w, h);
  return out;
}
