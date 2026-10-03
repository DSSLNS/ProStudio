/**
 * AI-powered editing actions. Every result is non-destructive: masks, masked
 * adjustment layers, patch/image layers, or a brand-new project (upscale).
 * All inference runs locally in the AI worker.
 */
import { useEditorStore } from "@/store/editorStore";
import { useUiStore } from "@/store/uiStore";
import { runAi } from "@/engine/ai/aiClient";
import { skinMask } from "@/engine/ai/imageOps";
import { exportImage } from "@/engine/export/exportClient";
import { combineSelection, expandSelection, featherSelection, type SelectionMode } from "@/engine/selection/selection";
import { rasterizeMask } from "@/engine/layers/raster";
import { findLayer, insertLayer, makeAdjustmentLayer, makeImageLayer, makeRetouchLayer, patchLayer, uniqueName } from "@/engine/layers/layerOps";
import { orientedSize } from "@/engine/image/transform";
import { BASE_LAYER_ID, type AdjustmentParams, type LayerDoc, type MaskDoc, type MaskOp } from "@/types/layers";
import { putAsset } from "@/storage/assets";
import { getDB } from "@/storage/indexedDB";
import { createProjectFromFile } from "@/storage/projects";
import { editorRuntime } from "../editorRuntime";
import { previewPixels, selectionBounds } from "../selection/selectionActions";

export type Progress = (fraction: number, message: string) => void;
const st = () => useEditorStore.getState();

async function coverageAsset(cov: Uint8Array, w: number, h: number, name: string): Promise<string> {
  const img = new ImageData(w, h);
  for (let i = 0; i < cov.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = cov[i];
  }
  const c = new OffscreenCanvas(w, h);
  c.getContext("2d")!.putImageData(img, 0, 0);
  const asset = await putAsset(await c.convertToBlob({ type: "image/png" }), name);
  editorRuntime.assets.put(asset.id, await createImageBitmap(c));
  return asset.id;
}

/** Segment what is currently displayed and return a raster op covering the visible frame window. */
export async function segmentVisible(model: "u2netp" | "skyseg", refine: number, onProgress?: Progress): Promise<{ op: MaskOp; coverage: number; backend: string }> {
  const px = previewPixels();
  const v = editorRuntime.view;
  if (!px || !v) throw new Error("The image is not ready yet.");
  const res = await runAi({ type: "segment", model, rgba: px.data.slice(), w: px.w, h: px.h, refine }, onProgress);
  const mask = res.mask!;
  let sum = 0;
  for (const m of mask) sum += m;
  const assetId = await coverageAsset(mask, res.w, res.h, `${model}-mask.png`);
  return {
    op: { type: "raster", mode: "add", assetId, x: v.originX, y: v.originY, w: res.w / v.scale, h: res.h / v.scale },
    coverage: sum / (255 * mask.length),
    backend: res.backend,
  };
}

const maskOf = (op: MaskOp, invert = false): MaskDoc => ({ base: 0, ops: invert ? [op, { type: "invert" }] : [op] });

export async function selectSubject(mode: SelectionMode, refine: number, p?: Progress) {
  const { op, backend } = await segmentVisible("u2netp", refine, p);
  st().setSelection(combineSelection(st().selection, op, mode));
  return backend;
}

export async function removeBackground(refine: number, p?: Progress) {
  const { op, coverage, backend } = await segmentVisible("u2netp", refine, p);
  if (coverage < 0.005) throw new Error("No clear subject was found in this image.");
  const s = st();
  s.setLayers(patchLayer(s.layers, BASE_LAYER_ID, { mask: maskOf(op), maskEnabled: true }), "Remove background (AI)");
  s.setActiveLayer(BASE_LAYER_ID);
  return backend;
}

function addMaskedAdjustment(name: string, mask: MaskDoc, label: string, preset: Partial<AdjustmentParams> = {}) {
  const s = st();
  const base = makeAdjustmentLayer(uniqueName(s.layers, name));
  const layer: LayerDoc = { ...base, adjustment: { ...base.adjustment, ...preset }, mask };
  s.setLayers(insertLayer(s.layers, layer, s.activeLayerId), label);
  s.setActiveLayer(layer.id);
  s.setPanel("layers");
}

export async function adjustSubject(background: boolean, refine: number, p?: Progress) {
  const { op, backend } = await segmentVisible("u2netp", refine, p);
  addMaskedAdjustment(background ? "Background" : "Subject", maskOf(op, background), background ? "Adjust background (AI)" : "Adjust subject (AI)");
  return backend;
}

export async function adjustSky(refine: number, p?: Progress) {
  const { op, coverage, backend } = await segmentVisible("skyseg", refine, p);
  if (coverage < 0.01) throw new Error("No sky was detected in this image.");
  addMaskedAdjustment("Sky", maskOf(op), "Adjust sky (AI)");
  return backend;
}

export async function selectSky(mode: SelectionMode, refine: number, p?: Progress) {
  const { op, backend } = await segmentVisible("skyseg", refine, p);
  st().setSelection(combineSelection(st().selection, op, mode));
  return backend;
}

// --- full-resolution renders through the export pipeline ---------------------

async function loadLut() {
  const r = st().recipe.lut;
  if (!r) return null;
  const rec = await (await getDB()).get("luts", r.id);
  return rec ? { id: rec.id, size: rec.size, data: rec.data, domainMin: rec.domainMin, domainMax: rec.domainMax } : null;
}

/** Render a frame-px region at full resolution (optionally base photo only) to RGBA. */
async function renderRegion(region: { x: number; y: number; w: number; h: number } | null, baseOnly: boolean, onProgress?: Progress) {
  const s = st();
  if (!s.project || !s.source || !s.sourceFormat) throw new Error("No image is open.");
  const f = orientedSize(s.project.width, s.project.height, s.recipe.geometry);
  const crop = region ? { x: region.x / f.width, y: region.y / f.height, width: region.w / f.width, height: region.h / f.height } : null;
  const res = await exportImage(
    {
      original: s.source,
      originalFormat: s.sourceFormat,
      recipe: { ...s.recipe, geometry: { ...s.recipe.geometry, crop } },
      layers: baseOnly ? [{ ...s.layers[0], mask: null }] : s.layers,
      lut: await loadLut(),
      format: "png",
      quality: 100,
      width: null,
      height: null,
      transparency: true,
      background: "#ffffff",
      preserveMetadata: false,
      stripGps: true,
      gpuAcceleration: useUiStore.getState().gpuAcceleration,
    },
    (fr, m) => onProgress?.(fr * 0.3, m),
  );
  const bmp = await createImageBitmap(res.blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  return { data: ctx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height, frame: f };
}

async function rgbaToPngAsset(rgba: Uint8ClampedArray, w: number, h: number, name: string): Promise<string> {
  const c = new OffscreenCanvas(w, h);
  c.getContext("2d")!.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  const asset = await putAsset(await c.convertToBlob({ type: "image/png" }), name);
  editorRuntime.assets.put(asset.id, await createImageBitmap(c));
  return asset.id;
}

const MAX_INPAINT_EDGE = 1024;

/**
 * Object removal: inpaint the area of the current selection (painted with the
 * selection brush or any selection tool). Returns a pending result that the
 * user applies or cancels; the original layers are never modified.
 */
export async function removeObject(onProgress?: Progress): Promise<{ apply: () => void; cancel: () => void; backend: string }> {
  const s = st();
  const sel = s.selection;
  if (!sel) throw new Error("Paint over the object (or select it) first.");
  const b = selectionBounds(sel);
  if (!b) throw new Error("The selection is empty.");
  const f = orientedSize(s.project!.width, s.project!.height, s.recipe.geometry);
  // Context around the object helps the model; keep it within the frame.
  const pad = Math.max(32, Math.round(Math.max(b.w, b.h) * 0.6));
  const region = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), w: 0, h: 0 };
  region.w = Math.min(f.width, b.x + b.w + pad) - region.x;
  region.h = Math.min(f.height, b.y + b.h + pad) - region.y;
  const src = await renderRegion(region, false, onProgress);
  // Mask at the region's full resolution, slightly grown so edges are fully covered.
  const grown = featherSelection(expandSelection(sel, Math.max(3, Math.max(b.w, b.h) * 0.02)), 1);
  const view = { originX: region.x, originY: region.y, scale: src.w / region.w, width: src.w, height: src.h };
  const mc = rasterizeMask(grown, view, editorRuntime.assets);
  const ma = mc.getContext("2d")!.getImageData(0, 0, src.w, src.h).data;
  // Inference resolution (the model fills at most MAX_INPAINT_EDGE px; result is upscaled to full res).
  const k = Math.min(1, MAX_INPAINT_EDGE / Math.max(src.w, src.h));
  const iw = Math.max(8, Math.round(src.w * k));
  const ih = Math.max(8, Math.round(src.h * k));
  const scaleCanvas = (rgba: Uint8ClampedArray, w: number, h: number, tw: number, th: number) => {
    const a = new OffscreenCanvas(w, h);
    a.getContext("2d")!.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
    const out = new OffscreenCanvas(tw, th);
    const ctx = out.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(a, 0, 0, tw, th);
    return ctx.getImageData(0, 0, tw, th).data;
  };
  const smallImg = k < 1 ? scaleCanvas(src.data, src.w, src.h, iw, ih) : src.data;
  const maskRgba = new Uint8ClampedArray(src.w * src.h * 4);
  for (let i = 0; i < src.w * src.h; i++) maskRgba[i * 4 + 3] = maskRgba[i * 4] = ma[i * 4 + 3];
  const smallMaskRgba = k < 1 ? scaleCanvas(maskRgba, src.w, src.h, iw, ih) : maskRgba;
  const smallMask = new Uint8Array(iw * ih);
  for (let i = 0; i < smallMask.length; i++) smallMask[i] = smallMaskRgba[i * 4 + 3] > 20 ? 255 : 0;
  const res = await runAi({ type: "inpaint", rgba: smallImg.slice(), mask: smallMask, w: iw, h: ih }, (fr, m) => onProgress?.(0.3 + fr * 0.6, m));
  const filled = k < 1 ? scaleCanvas(res.rgba!, iw, ih, src.w, src.h) : res.rgba!;
  const assetId = await rgbaToPngAsset(filled, src.w, src.h, "object-removal.png");
  onProgress?.(1, "Done");
  const before = st().layers;
  const patch: LayerDoc = {
    ...makeImageLayer(uniqueName(before, "Object removal"), assetId, { x: region.x + region.w / 2, y: region.y + region.h / 2, width: region.w, height: region.h, rotation: 0 }),
    mask: { base: 0, ops: [{ type: "mask", mode: "add", mask: grown }] },
  };
  // Preview: show the patch without a history entry until the user applies it.
  st().updateLayers((ls) => insertLayer(ls, patch, ls[ls.length - 1]?.id));
  return {
    backend: res.backend,
    apply: () => {
      st().commit("Object removal (AI)");
      st().setActiveLayer(patch.id);
      st().setSelection(null);
    },
    cancel: () => st().updateLayers(() => before),
  };
}

/** AI denoise of the developed photo at full resolution, as a blendable layer above the base. */
export async function aiDenoise(intensity: number, onProgress?: Progress) {
  const src = await renderRegion(null, true, onProgress);
  if (src.w * src.h > 40e6) throw new Error("This image is too large for in-browser AI denoising (limit ≈40 MP).");
  const res = await runAi({ type: "denoise", rgba: src.data.slice(), w: src.w, h: src.h }, (fr, m) => onProgress?.(0.3 + fr * 0.65, m));
  const assetId = await rgbaToPngAsset(res.rgba!, res.w, res.h, "ai-denoise.png");
  const s = st();
  const layer = { ...makeImageLayer(uniqueName(s.layers, "AI Denoise"), assetId, { x: src.frame.width / 2, y: src.frame.height / 2, width: src.frame.width, height: src.frame.height, rotation: 0 }), opacity: intensity };
  s.setLayers(insertLayer(s.layers, layer, BASE_LAYER_ID), "AI denoise");
  s.setActiveLayer(layer.id);
  onProgress?.(1, "Done");
  return res.backend;
}

export const UPSCALE_LIMIT_PX = 64e6;
export const UPSCALE_LIMIT_EDGE = 16384;

/** AI upscaling of the current edit into a NEW project (the original project is untouched). */
export async function aiUpscale(factor: 2 | 4, onProgress?: Progress): Promise<string> {
  const s = st();
  const src = await renderRegion(
    s.recipe.geometry.crop
      ? (() => {
          const f = orientedSize(s.project!.width, s.project!.height, s.recipe.geometry);
          const c = s.recipe.geometry.crop!;
          return { x: c.x * f.width, y: c.y * f.height, w: c.width * f.width, h: c.height * f.height };
        })()
      : null,
    false,
    onProgress,
  );
  if (src.w * factor * src.h * factor > UPSCALE_LIMIT_PX || Math.max(src.w, src.h) * factor > UPSCALE_LIMIT_EDGE) {
    throw new Error(`A ${factor}× result (${src.w * factor} × ${src.h * factor}) exceeds the in-browser limit (${UPSCALE_LIMIT_PX / 1e6} MP / ${UPSCALE_LIMIT_EDGE}px).`);
  }
  const res = await runAi({ type: "upscale", rgba: src.data.slice(), w: src.w, h: src.h, factor }, (fr, m) => onProgress?.(0.3 + fr * 0.6, m));
  const c = new OffscreenCanvas(res.w, res.h);
  c.getContext("2d")!.putImageData(new ImageData(res.rgba! as Uint8ClampedArray<ArrayBuffer>, res.w, res.h), 0, 0);
  const blob = await c.convertToBlob({ type: "image/png" });
  const project = await createProjectFromFile(blob, { name: `${s.project!.name} (AI ${factor}×)`, format: "png" });
  onProgress?.(1, "Done");
  return project.id;
}

/**
 * Portrait enhancement: texture-preserving skin smoothing + a tone layer,
 * both masked to skin inside the detected subject. Never warps or reshapes
 * faces — identity and facial structure are untouched.
 */
export async function portraitEnhance(refine: number, onProgress?: Progress) {
  const px = previewPixels();
  const v = editorRuntime.view;
  if (!px || !v) throw new Error("The image is not ready yet.");
  const seg = await runAi({ type: "segment", model: "u2netp", rgba: px.data.slice(), w: px.w, h: px.h, refine }, onProgress);
  const skin = skinMask(px.data, px.w, px.h);
  const cov = new Uint8Array(px.w * px.h);
  let n = 0;
  for (let i = 0; i < cov.length; i++) {
    cov[i] = Math.round(skin[i] * seg.mask![i]);
    if (cov[i] > 128) n++;
  }
  if (n / cov.length < 0.003) throw new Error("No skin was detected on the main subject.");
  const assetId = await coverageAsset(cov, px.w, px.h, "skin-mask.png");
  const skinOp: MaskOp = { type: "raster", mode: "add", assetId, x: v.originX, y: v.originY, w: px.w / v.scale, h: px.h / v.scale };
  const clip: MaskDoc = { base: 0, ops: [skinOp, { type: "feather", radius: 2 / v.scale }] };
  const s = st();
  const f = orientedSize(s.project!.width, s.project!.height, s.recipe.geometry);
  const smoothing = {
    ...makeRetouchLayer(uniqueName(s.layers, "Portrait smoothing")),
    opacity: 60,
    ops: [
      {
        tool: "skin" as const,
        points: [f.width / 2, f.height / 2, 1],
        brush: { size: Math.hypot(f.width, f.height) * 2.2, hardness: 1, opacity: 1, flow: 1, spacing: 1, pressureSize: false },
        strength: 0.85,
        clip,
      },
    ],
  };
  const tone: LayerDoc = { ...makeAdjustmentLayer(uniqueName(s.layers, "Portrait tone")), mask: clip };
  let layers = insertLayer(s.layers, smoothing, s.activeLayerId);
  layers = insertLayer(layers, tone, smoothing.id);
  s.setLayers(layers, "Portrait enhancement (AI)");
  s.setActiveLayer(tone.id);
  s.setPanel("layers");
  return seg.backend;
}

/** Subject statistics for AI-assisted Auto Edit. */
export async function subjectLuma(p?: Progress): Promise<{ subjectMedian: number; coverage: number } | null> {
  const px = previewPixels();
  if (!px) return null;
  const res = await runAi({ type: "segment", model: "u2netp", rgba: px.data.slice(), w: px.w, h: px.h, refine: 0 }, p);
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < res.mask!.length; i++) {
    if (res.mask![i] < 160) continue;
    const y = Math.round(0.2126 * px.data[i * 4] + 0.7152 * px.data[i * 4 + 1] + 0.0722 * px.data[i * 4 + 2]);
    hist[y]++;
    n++;
  }
  if (n < res.mask!.length * 0.02) return null;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= n / 2) return { subjectMedian: i / 255, coverage: n / res.mask!.length };
  }
  return null;
}

export function activeLayerName(): string {
  const s = st();
  return findLayer(s.layers, s.activeLayerId)?.name ?? "";
}
