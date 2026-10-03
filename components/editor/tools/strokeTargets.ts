/**
 * Decides where a brush/eraser/gradient gesture goes and builds the live
 * operation. Every target is non-destructive:
 *   • editing a mask      → mask stroke (reveal/hide)
 *   • paint layer         → paint/eraser op on that layer
 *   • any other layer     → brush creates a paint layer above it;
 *                           eraser hides pixels through the layer's mask
 */
import { toast } from "sonner";
import { useEditorStore } from "@/store/editorStore";
import { useToolStore } from "@/store/toolStore";
import { emptyMask, type LayerDoc, type MaskOp, type PaintOp, type RetouchOp } from "@/types/layers";
import { findLayer, insertLayer, makePaintLayer, makeRetouchLayer, patchLayer, uniqueName } from "@/engine/layers/layerOps";
import { findHealSource } from "@/engine/layers/healSource";
import { useViewState } from "../viewState";
import { bgEraseDabs } from "@/engine/layers/bgErase";
import { strokeBounds, strokeDabs } from "@/engine/layers/dabs";
import { putAsset } from "@/storage/assets";
import { editorRuntime } from "../editorRuntime";
import { previewPixels } from "../selection/selectionActions";

export interface LiveStroke {
  /** Add an input sample (frame px, pressure 0..1). */
  add(x: number, y: number, pressure: number): void;
  /** Commit to history (or discard if `cancel`). */
  end(cancel?: boolean): void | Promise<void>;
}

type Target =
  | { kind: "mask"; layerId: string; mode: "add" | "subtract" }
  | { kind: "paint"; layerId: string; tool: PaintOp["tool"] };

function resolveTarget(tool: "brush" | "pencil" | "eraser"): { target: Target; created: boolean; label: string } | null {
  const s = useEditorStore.getState();
  const t = useToolStore.getState();
  const active = findLayer(s.layers, s.activeLayerId);
  if (!active) return null;
  if (active.locked) {
    toast.error(`“${active.name}” is locked.`);
    return null;
  }
  if (s.editingMask && active.mask) {
    const reveal = t.maskPaint === "reveal";
    const mode = (tool === "eraser" ? !reveal : reveal) ? "add" : "subtract";
    return { target: { kind: "mask", layerId: active.id, mode }, created: false, label: mode === "add" ? "Paint mask (reveal)" : "Paint mask (hide)" };
  }
  if (active.kind === "paint") return { target: { kind: "paint", layerId: active.id, tool }, created: false, label: tool === "eraser" ? "Erase" : "Brush stroke" };
  if (tool === "eraser") {
    // Non-destructive erase: hide through the layer's mask.
    return { target: { kind: "mask", layerId: active.id, mode: "subtract" }, created: false, label: "Erase (mask)" };
  }
  const layer = makePaintLayer(uniqueName(s.layers, "Paint"));
  s.updateLayers((ls) => insertLayer(ls, layer, active.id));
  s.setActiveLayer(layer.id);
  return { target: { kind: "paint", layerId: layer.id, tool }, created: true, label: "Brush stroke" };
}

export function beginPaintStroke(tool: "brush" | "pencil" | "eraser"): LiveStroke | null {
  const r = resolveTarget(tool);
  if (!r) return null;
  const s = useEditorStore.getState();
  const t = useToolStore.getState();
  const before = s.layers;
  const points: number[] = [];
  const brush = { ...t.brush, ...(tool === "pencil" ? { hardness: 1 } : {}) };
  const clip = s.selection ?? undefined;
  const id = r.target.layerId;
  /** Index of the live op inside the target's op list (replaced on every sample). */
  let liveIndex = -1;

  const write = () => {
    if (r.target.kind === "mask") {
      const op: MaskOp = clip
        ? { type: "mask", mode: r.target.mode, mask: { base: 0, ops: [{ type: "stroke", mode: "add", points, brush, value: 1 }, { type: "mask", mode: "intersect", mask: clip }] } }
        : { type: "stroke", mode: r.target.mode, points, brush, value: 1 };
      s.updateLayers((ls) =>
        patchLayer(ls, id, (l: LayerDoc) => {
          const mask = l.mask ?? emptyMask(1);
          const ops = liveIndex >= 0 ? [...mask.ops.slice(0, liveIndex), op] : [...mask.ops, op];
          liveIndex = ops.length - 1;
          return { mask: { ...mask, ops }, maskEnabled: true };
        }),
      );
    } else {
      const tool = r.target.tool;
      const op: PaintOp = { tool, points, brush, color: t.color, ...(clip ? { clip } : {}) };
      s.updateLayers((ls) =>
        patchLayer(ls, id, (l: LayerDoc) => {
          if (l.kind !== "paint") return {};
          const ops = liveIndex >= 0 ? [...l.ops.slice(0, liveIndex), op] : [...l.ops, op];
          liveIndex = ops.length - 1;
          return { ops };
        }),
      );
    }
  };

  return {
    add(x, y, pressure) {
      points.push(x, y, pressure);
      write();
    },
    end(cancel) {
      if (cancel || points.length === 0) {
        useEditorStore.getState().updateLayers(() => before);
        return;
      }
      useEditorStore.getState().commit(r.created ? "New paint layer" : r.label);
    },
  };
}

/** Gradient on the active layer's mask (creates one if needed). */
export function beginGradient(): { update(x0: number, y0: number, x1: number, y1: number): void; end(cancel?: boolean): void } | null {
  const s = useEditorStore.getState();
  const active = findLayer(s.layers, s.activeLayerId);
  if (!active) return null;
  if (active.locked) {
    toast.error(`“${active.name}” is locked.`);
    return null;
  }
  const before = s.layers;
  const kind = useToolStore.getState().gradientKind;
  const baseOps = active.mask?.ops ?? [];
  return {
    update(x0, y0, x1, y1) {
      const op: MaskOp = { type: "gradient", mode: "replace", kind, x0, y0, x1, y1 };
      s.updateLayers((ls) => patchLayer(ls, active.id, { mask: { base: active.mask?.base ?? 1, ops: [...baseOps, op] }, maskEnabled: true }));
    },
    end(cancel) {
      if (cancel) useEditorStore.getState().updateLayers(() => before);
      else {
        useEditorStore.getState().commit("Gradient mask");
        useEditorStore.getState().setEditingMask(true);
      }
    },
  };
}

/**
 * Background eraser: hides pixels similar to the colour sampled under the brush
 * at stroke start, through the active layer's mask (non-destructive). Works on
 * the displayed image at preview resolution.
 */
export function beginBackgroundErase(x: number, y: number): LiveStroke | null {
  const s = useEditorStore.getState();
  const active = findLayer(s.layers, s.activeLayerId);
  const v = editorRuntime.view;
  const px = previewPixels();
  if (!active || !v || !px) return null;
  if (active.locked) {
    toast.error(`“${active.name}” is locked.`);
    return null;
  }
  const before = s.layers;
  const t = useToolStore.getState();
  const toRender = (fx: number, fy: number): [number, number] => [(fx - v.originX) * v.scale, (fy - v.originY) * v.scale];
  const [sx, sy] = toRender(x, y).map(Math.floor);
  const si = (Math.max(0, Math.min(px.h - 1, sy)) * px.w + Math.max(0, Math.min(px.w - 1, sx))) * 4;
  const sample: [number, number, number] = [px.data[si], px.data[si + 1], px.data[si + 2]];
  const coverage = new Uint8Array(px.w * px.h);
  const points: number[] = [];
  const tempId = `bgerase-live-${Date.now()}`;
  const baseOps = active.mask?.ops ?? [];
  const brush = { ...t.brush };
  let frame = 0;

  const flush = async () => {
    frame = 0;
    const img = new ImageData(px.w, px.h);
    for (let i = 0; i < coverage.length; i++) {
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = coverage[i];
    }
    editorRuntime.assets.put(tempId, await createImageBitmap(img));
    const op: MaskOp = { type: "raster", mode: "subtract", assetId: tempId, x: v.originX, y: v.originY, w: px.w / v.scale, h: px.h / v.scale };
    useEditorStore.getState().updateLayers((ls) => patchLayer(ls, active.id, { mask: { base: active.mask?.base ?? 1, ops: [...baseOps, op] }, maskEnabled: true }));
  };

  return {
    add(fx, fy, p) {
      const prevLen = points.length;
      points.push(fx, fy, p);
      // Only the dabs of the newest segment need processing.
      const seg = points.slice(Math.max(0, prevLen - 3));
      bgEraseDabs(px.data, px.w, px.h, coverage, strokeDabs(seg, brush), toRender, v.scale, sample, (t.bgEraserTolerance / 100) * 255, brush.hardness);
      if (!frame) frame = requestAnimationFrame(() => void flush());
    },
    async end(cancel) {
      if (frame) cancelAnimationFrame(frame);
      if (cancel || !points.length) {
        useEditorStore.getState().updateLayers(() => before);
        editorRuntime.assets.drop(tempId);
        return;
      }
      // Persist the coverage as a small PNG asset and swap it into the op.
      const c = new OffscreenCanvas(px.w, px.h);
      const img = new ImageData(px.w, px.h);
      for (let i = 0; i < coverage.length; i++) {
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
        img.data[i * 4 + 3] = coverage[i];
      }
      c.getContext("2d")!.putImageData(img, 0, 0);
      const asset = await putAsset(await c.convertToBlob({ type: "image/png" }), "background-erase.png");
      editorRuntime.assets.put(asset.id, await createImageBitmap(c));
      const op: MaskOp = { type: "raster", mode: "subtract", assetId: asset.id, x: v.originX, y: v.originY, w: px.w / v.scale, h: px.h / v.scale };
      const st = useEditorStore.getState();
      st.updateLayers(() => patchLayer(before, active.id, { mask: { base: active.mask?.base ?? 1, ops: [...baseOps, op] }, maskEnabled: true }));
      st.commit("Background eraser");
      editorRuntime.assets.drop(tempId);
    },
  };
}

const RETOUCH_MAP: Record<string, RetouchOp["tool"]> = {
  clone: "clone",
  heal: "heal",
  "spot-heal": "heal",
  redeye: "redeye",
  dodge: "dodge",
  burn: "burn",
  smudge: "smudge",
  "blur-brush": "blur",
  "sharpen-brush": "sharpen",
  dust: "dust",
};

/**
 * Retouch strokes go into a retouch layer (created above the active layer if
 * needed). Clone/heal need a source: Alt-click (or "Set source") first.
 * Spot healing picks its own source when the stroke ends.
 */
export function beginRetouchStroke(editorTool: string, x: number, y: number, alt: boolean): LiveStroke | null {
  const vs = useViewState.getState();
  const tool = RETOUCH_MAP[editorTool];
  if (!tool) return null;
  if ((editorTool === "clone" || editorTool === "heal") && (alt || vs.pickingSource)) {
    vs.set({ cloneSource: [x, y], cloneOffset: null, pickingSource: false });
    toast.info("Source set. Now paint where you want to copy it.");
    return null;
  }
  if ((editorTool === "clone" || editorTool === "heal") && !vs.cloneSource) {
    toast.info("Alt-click (or tap “Set source”) to choose where to sample from first.");
    return null;
  }
  if (!editorRuntime.view) return null;
  const s = useEditorStore.getState();
  const t = useToolStore.getState();
  const active = findLayer(s.layers, s.activeLayerId);
  if (!active) return null;
  let layerId: string;
  let created = false;
  if (active.kind === "retouch") {
    if (active.locked) {
      toast.error(`“${active.name}” is locked.`);
      return null;
    }
    layerId = active.id;
  } else {
    const layer = makeRetouchLayer(uniqueName(s.layers, "Retouch"));
    s.updateLayers((ls) => insertLayer(ls, layer, active.id));
    s.setActiveLayer(layer.id);
    layerId = layer.id;
    created = true;
  }
  const before = s.layers;
  let offset: [number, number] | undefined;
  if (editorTool === "clone" || editorTool === "heal") {
    const src = vs.cloneSource!;
    if (t.cloneAligned && vs.cloneOffset) offset = vs.cloneOffset;
    else {
      offset = [src[0] - x, src[1] - y];
      if (t.cloneAligned) vs.set({ cloneOffset: offset });
    }
  }
  const points: number[] = [];
  // Click-style corrections replace the defect fully rather than building up with flow.
  const brush = { ...t.brush, ...(editorTool === "spot-heal" || editorTool === "redeye" ? { flow: 1 } : {}) };
  const clip = s.selection ?? undefined;
  let liveIndex = -1;
  const make = (): RetouchOp => ({
    tool,
    points,
    brush,
    strength: t.retouchStrength,
    ...(offset ? { offset } : {}),
    ...(tool === "dodge" || tool === "burn" ? { range: t.dodgeRange } : {}),
    ...(tool === "dust" ? { threshold: t.dustThreshold } : {}),
    ...(clip ? { clip } : {}),
  });
  const write = (op: RetouchOp) =>
    useEditorStore.getState().updateLayers((ls) =>
      patchLayer(ls, layerId, (l: LayerDoc) => {
        if (l.kind !== "retouch") return {};
        const ops = liveIndex >= 0 ? [...l.ops.slice(0, liveIndex), op] : [...l.ops, op];
        liveIndex = ops.length - 1;
        return { ops };
      }),
    );
  const label: Record<string, string> = {
    clone: "Clone stamp",
    heal: "Healing brush",
    "spot-heal": "Spot healing",
    redeye: "Red-eye removal",
    dodge: "Dodge",
    burn: "Burn",
    smudge: "Smudge",
    "blur-brush": "Blur brush",
    "sharpen-brush": "Sharpen brush",
    dust: "Dust & scratches",
  };
  return {
    add(px, py, p) {
      points.push(px, py, p);
      // Spot healing shows nothing until its source is chosen on release.
      if (editorTool !== "spot-heal") write(make());
    },
    end(cancel) {
      const st = useEditorStore.getState();
      if (cancel || !points.length) {
        st.updateLayers(() => (created ? before.filter((l) => l.id !== layerId) : before));
        return;
      }
      if (editorTool === "spot-heal") {
        const v = editorRuntime.view;
        const px = previewPixels();
        if (!v || !px) return;
        const b = strokeBounds(points, brush);
        const defect = {
          x: Math.floor((b.x0 - v.originX) * v.scale),
          y: Math.floor((b.y0 - v.originY) * v.scale),
          w: Math.ceil((b.x1 - b.x0) * v.scale),
          h: Math.ceil((b.y1 - b.y0) * v.scale),
        };
        const off = findHealSource(px.data, px.w, px.h, defect);
        if (!off) {
          toast.error("Couldn't find a suitable source area nearby. Try the healing brush with a manual source.");
          st.updateLayers(() => before);
          return;
        }
        offset = [off[0] / v.scale, off[1] / v.scale];
        write(make());
      }
      st.commit(created ? `New retouch layer · ${label[editorTool]}` : label[editorTool]);
    },
  };
}

/** Selection brush: paints into the selection (used to mark objects for AI removal). */
export function beginSelectionBrush(alt: boolean): LiveStroke {
  const s = useEditorStore.getState();
  const start = s.selection;
  const points: number[] = [];
  const brush = { ...useToolStore.getState().brush };
  return {
    add(x, y, p) {
      points.push(x, y, p);
      const op: MaskOp = { type: "stroke", mode: alt ? "subtract" : "add", points, brush, value: 1 };
      const base = start ?? { base: 0 as const, ops: [] };
      useEditorStore.getState().setSelection({ ...base, ops: [...base.ops, op] });
    },
    end(cancel) {
      if (cancel) useEditorStore.getState().setSelection(start);
    },
  };
}
