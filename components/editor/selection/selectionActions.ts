/**
 * Selection commands shared by tools, menus and shortcuts.
 */
import { toast } from "sonner";
import { useEditorStore } from "@/store/editorStore";
import { useToolStore } from "@/store/toolStore";
import { useUiStore } from "@/store/uiStore";
import {
  colorRange,
  combineSelection,
  coverageBounds,
  expandSelection,
  featherSelection,
  invertSelection,
  magicWand,
  selectAll,
  type SelectionMode,
} from "@/engine/selection/selection";
import { rasterizeMask } from "@/engine/layers/raster";
import { findLayer, insertLayer, makeAdjustmentLayer, makeImageLayer, subtreeIds, uniqueName } from "@/engine/layers/layerOps";
import { orientedSize } from "@/engine/image/transform";
import { BASE_LAYER_ID, type LayerDoc, type MaskDoc, type MaskOp } from "@/types/layers";
import { putAsset } from "@/storage/assets";
import { getDB } from "@/storage/indexedDB";
import { exportImage } from "@/engine/export/exportClient";
import { editorRuntime } from "../editorRuntime";
import { currentFrame } from "../layers/useLayerActions";

const st = () => useEditorStore.getState();

export function applySelectionOp(op: MaskOp, mode: SelectionMode) {
  st().setSelection(combineSelection(st().selection, op, mode));
}

export const selectionCommands = {
  selectAll: () => st().setSelection(selectAll()),
  deselect: () => st().setSelection(null),
  invert: () => st().setSelection(invertSelection(st().selection)),
  feather: (r: number) => {
    const s = st().selection;
    if (s && r > 0) st().setSelection(featherSelection(s, r));
  },
  expand: (r: number) => {
    const s = st().selection;
    if (s && r !== 0) st().setSelection(expandSelection(s, r));
  },
};

/** Pixels of the currently displayed (composited) preview. */
export function previewPixels(): { data: Uint8ClampedArray; w: number; h: number } | null {
  const c = editorRuntime.canvas;
  if (!c || !c.width) return null;
  const t = document.createElement("canvas");
  t.width = c.width;
  t.height = c.height;
  const ctx = t.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(c, 0, 0);
  return { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
}

/** Store a coverage map (render resolution) as a raster selection op covering the current view. */
export async function coverageToOp(cov: Uint8Array, w: number, h: number, mode: SelectionMode) {
  const v = editorRuntime.view;
  if (!v) return;
  const img = new ImageData(w, h);
  for (let i = 0; i < cov.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = cov[i];
  }
  const c = new OffscreenCanvas(w, h);
  c.getContext("2d")!.putImageData(img, 0, 0);
  const blob = await c.convertToBlob({ type: "image/png" });
  const asset = await putAsset(blob, "selection.png");
  editorRuntime.assets.put(asset.id, await createImageBitmap(c));
  applySelectionOp({ type: "raster", mode: "add", assetId: asset.id, x: v.originX, y: v.originY, w: w / v.scale, h: h / v.scale }, mode);
}

export async function magicWandAt(renderX: number, renderY: number, mode: SelectionMode) {
  const px = previewPixels();
  if (!px) return;
  const t = useToolStore.getState();
  const cov = magicWand(px.data, px.w, px.h, Math.floor(renderX), Math.floor(renderY), (t.wandTolerance / 100) * 255, t.wandContiguous);
  await coverageToOp(cov, px.w, px.h, mode);
}

export async function colorRangeSelect(rgb: [number, number, number], fuzziness: number, mode: SelectionMode) {
  const px = previewPixels();
  if (!px) return;
  await coverageToOp(colorRange(px.data, px.w, px.h, rgb, fuzziness), px.w, px.h, mode);
}

/** Bounds of a selection in frame px (via a low-resolution rasterisation), clamped to the frame. */
export function selectionBounds(sel: MaskDoc): { x: number; y: number; w: number; h: number } | null {
  const f = currentFrame();
  const scale = Math.min(1, 1024 / Math.max(f.width, f.height));
  const view = { originX: 0, originY: 0, scale, width: Math.ceil(f.width * scale), height: Math.ceil(f.height * scale) };
  const c = rasterizeMask(sel, view, editorRuntime.assets);
  const data = c.getContext("2d")!.getImageData(0, 0, view.width, view.height).data;
  const b = coverageBounds(data, view.width, view.height, 4, 3, 1);
  if (!b) return null;
  const x = Math.max(0, Math.floor(b.x / scale) - 1);
  const y = Math.max(0, Math.floor(b.y / scale) - 1);
  return { x, y, w: Math.min(f.width - x, Math.ceil(b.w / scale) + 2), h: Math.min(f.height - y, Math.ceil(b.h / scale) + 2) };
}

export function cropToSelection() {
  const sel = st().selection;
  if (!sel) return toast.info("Make a selection first.");
  const b = selectionBounds(sel);
  if (!b) return toast.info("The selection is empty.");
  const f = currentFrame();
  st().applyRecipe("Crop to selection", (r) => {
    r.geometry.crop = { x: b.x / f.width, y: b.y / f.height, width: b.w / f.width, height: b.h / f.height };
  });
}

export function adjustmentFromSelection() {
  const s = st();
  const sel = s.selection;
  const layer = { ...makeAdjustmentLayer(uniqueName(s.layers, "Adjustment")), mask: sel ? { base: 0 as const, ops: [{ type: "mask" as const, mode: "add" as const, mask: sel }] } : null };
  s.setLayers(insertLayer(s.layers, layer, s.activeLayerId), sel ? "Adjustment from selection" : "Add adjustment layer");
  s.setActiveLayer(layer.id);
  s.setPanel("layers");
}

// --- copy / paste ------------------------------------------------------------

interface AppClipboard {
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
let clipboard: AppClipboard | null = null;

/**
 * Copy the active layer's pixels inside the selection at FULL resolution
 * (rendered from the original through the export pipeline), to an in-app
 * clipboard and — where permitted — the system clipboard as PNG.
 */
export async function copySelection() {
  const s = st();
  if (!s.project || !s.source || !s.sourceFormat) return;
  const active = findLayer(s.layers, s.activeLayerId);
  if (!active) return;
  const f = orientedSize(s.project.width, s.project.height, s.recipe.geometry);
  const sel = s.selection;
  const b = sel ? selectionBounds(sel) : { x: 0, y: 0, w: f.width, h: f.height };
  if (!b) return toast.info("The selection is empty.");
  if (active.kind === "adjustment" || active.kind === "retouch") return toast.info("Select a pixel layer (photo, image, text, shape or paint) to copy.");

  const clip = (l: LayerDoc): LayerDoc => {
    if (!sel) return l;
    const ops: MaskOp[] = [...(l.mask && l.maskEnabled ? [{ type: "mask" as const, mode: "add" as const, mask: l.mask }] : [{ type: "rect" as const, mode: "add" as const, x: -1e6, y: -1e6, w: 2e6, h: 2e6 }]), { type: "mask", mode: "intersect", mask: sel }];
    return { ...l, mask: { base: 0, ops }, maskEnabled: true, opacity: 100, visible: true };
  };
  const base = s.layers[0];
  // Copy just the active layer (a group copies its whole subtree) over a hidden base.
  const sub = subtreeIds(s.layers, active.id);
  const layers: LayerDoc[] =
    active.id === BASE_LAYER_ID
      ? [clip(base)]
      : [
          { ...base, visible: false },
          ...s.layers
            .filter((l) => sub.has(l.id))
            .map((l) => (l.id === active.id ? clip({ ...l, parentId: null, blendMode: "normal" }) : l)),
        ];
  const toastId = toast.loading("Copying at full resolution…");
  try {
    let lut = null;
    if (s.recipe.lut) {
      const rec = await (await getDB()).get("luts", s.recipe.lut.id);
      if (rec) lut = { id: rec.id, size: rec.size, data: rec.data, domainMin: rec.domainMin, domainMax: rec.domainMax };
    }
    const res = await exportImage({
      original: s.source,
      originalFormat: s.sourceFormat,
      recipe: { ...s.recipe, geometry: { ...s.recipe.geometry, crop: { x: b.x / f.width, y: b.y / f.height, width: b.w / f.width, height: b.h / f.height } } },
      layers,
      lut,
      format: "png",
      quality: 100,
      width: null,
      height: null,
      transparency: true,
      background: "#ffffff",
      preserveMetadata: false,
      stripGps: true,
      gpuAcceleration: useUiStore.getState().gpuAcceleration,
    });
    const asset = await putAsset(res.blob, "clipboard.png");
    clipboard = { assetId: asset.id, ...b };
    try {
      await navigator.clipboard?.write?.([new ClipboardItem({ "image/png": res.blob })]);
    } catch {
      /* system clipboard not permitted — in-app clipboard still works */
    }
    toast.success(`Copied ${res.width} × ${res.height}`, { id: toastId });
  } catch (e) {
    toast.error(`Copy failed: ${(e as Error).message}`, { id: toastId });
  }
}

export const hasAppClipboard = () => clipboard !== null;

/** Paste the in-app clipboard as a new image layer at its original position. */
export function pasteClipboard(): boolean {
  if (!clipboard) return false;
  const s = st();
  const c = clipboard;
  const layer = makeImageLayer(uniqueName(s.layers, "Pasted"), c.assetId, { x: c.x + c.w / 2, y: c.y + c.h / 2, width: c.w, height: c.h, rotation: 0 });
  s.setLayers(insertLayer(s.layers, layer, s.activeLayerId), "Paste");
  s.setActiveLayer(layer.id);
  return true;
}

/** Paste an image file (system clipboard / drag) as a new layer centred in view. */
export async function pasteImageFile(blob: Blob) {
  const bmp = await createImageBitmap(blob);
  const asset = await putAsset(blob, "pasted image");
  editorRuntime.assets.put(asset.id, bmp);
  const s = st();
  const f = currentFrame();
  const fit = Math.min(1, (0.8 * f.width) / bmp.width, (0.8 * f.height) / bmp.height);
  const v = editorRuntime.view;
  const cx = v ? v.originX + v.width / v.scale / 2 : f.width / 2;
  const cy = v ? v.originY + v.height / v.scale / 2 : f.height / 2;
  const layer = makeImageLayer(uniqueName(s.layers, "Pasted"), asset.id, { x: cx, y: cy, width: bmp.width * fit, height: bmp.height * fit, rotation: 0 });
  s.setLayers(insertLayer(s.layers, layer, s.activeLayerId), "Paste image");
  s.setActiveLayer(layer.id);
}
