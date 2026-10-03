"use client";

import { useMemo } from "react";
import { toast } from "sonner";
import { useEditorStore } from "@/store/editorStore";
import { orientedSize } from "@/engine/image/transform";
import { renderToFrame } from "@/engine/layers/view";
import {
  duplicateLayer,
  findLayer,
  groupLayer,
  insertLayer,
  makeAdjustmentLayer,
  makeImageLayer,
  makeShapeLayer,
  makeTextLayer,
  nudgeLayer,
  patchLayer,
  removeLayer,
  ungroupLayer,
  uniqueName,
} from "@/engine/layers/layerOps";
import { measureText } from "@/engine/layers/raster";
import { BASE_LAYER_ID, type LayerDoc, type Placement } from "@/types/layers";
import { putAsset } from "@/storage/assets";
import { decodeToBitmap, sniffFormat, MAX_FILE_BYTES } from "@/lib/fileUtils";
import { editorRuntime } from "../editorRuntime";

/** Frame size (full-res px of the warped, uncropped frame). */
export function currentFrame(): { width: number; height: number } {
  const { project, recipe } = useEditorStore.getState();
  if (!project) return { width: 1, height: 1 };
  return orientedSize(project.width, project.height, recipe.geometry);
}

/** Centre of what is currently visible, in frame px. */
export function visibleCentre(): [number, number] {
  const v = editorRuntime.view;
  if (!v) {
    const f = currentFrame();
    return [f.width / 2, f.height / 2];
  }
  return renderToFrame(v, v.width / 2, v.height / 2);
}

const NATIVE_FORMATS = new Set(["jpeg", "png", "webp", "avif", "gif", "bmp"]);

/** All layer-stack commands, each producing one history entry. */
export function useLayerActions() {
  return useMemo(() => {
    const st = () => useEditorStore.getState();
    const commit = (layers: LayerDoc[], label: string, activeId?: string) => {
      st().setLayers(layers, label);
      if (activeId) st().setActiveLayer(activeId);
    };
    const add = (layer: LayerDoc, label: string) => {
      const s = st();
      commit(insertLayer(s.layers, layer, s.activeLayerId), label, layer.id);
    };
    const frameShort = () => {
      const f = currentFrame();
      return Math.min(f.width, f.height);
    };

    return {
      add,
      addText() {
        const [x, y] = visibleCentre();
        const fontSize = Math.round(frameShort() * 0.08);
        const l = makeTextLayer(uniqueName(st().layers, "Text"), { x, y, width: 1, height: 1, rotation: 0 }, fontSize);
        const m = measureText(l);
        add({ ...l, placement: { ...l.placement, width: m.width, height: m.height } }, "Add text layer");
      },
      addShape(shape: "rectangle" | "ellipse", placement?: Placement) {
        const [x, y] = visibleCentre();
        const s = frameShort() * 0.3;
        add(
          makeShapeLayer(uniqueName(st().layers, shape === "ellipse" ? "Ellipse" : "Rectangle"), shape, placement ?? { x, y, width: s, height: s, rotation: 0 }),
          "Add shape layer",
        );
      },
      addAdjustment() {
        add(makeAdjustmentLayer(uniqueName(st().layers, "Adjustment")), "Add adjustment layer");
      },
      async addImageFromFile(file: File) {
        if (file.size > MAX_FILE_BYTES) return toast.error("This file is too large.");
        try {
          const format = await sniffFormat(file, file.name);
          const bmp = await decodeToBitmap(file, format);
          // Keep browser-native formats byte-for-byte; convert others (TIFF/SVG/RAW…) losslessly to PNG.
          let blob: Blob = file;
          if (!NATIVE_FORMATS.has(format)) {
            const c = new OffscreenCanvas(bmp.width, bmp.height);
            c.getContext("2d")!.drawImage(bmp, 0, 0);
            blob = await c.convertToBlob({ type: "image/png" });
          }
          const asset = await putAsset(blob, file.name);
          editorRuntime.assets.put(asset.id, bmp);
          const f = currentFrame();
          const [x, y] = visibleCentre();
          const fit = Math.min(1, (0.6 * f.width) / bmp.width, (0.6 * f.height) / bmp.height);
          const name = uniqueName(st().layers, file.name.replace(/\.[^.]+$/, "") || "Image");
          add(makeImageLayer(name, asset.id, { x, y, width: bmp.width * fit, height: bmp.height * fit, rotation: 0 }), "Add image layer");
        } catch (e) {
          toast.error(`Could not add image: ${(e as Error).message}`);
        }
      },
      duplicate(id = st().activeLayerId) {
        const r = duplicateLayer(st().layers, id);
        if (r.newId) commit(r.layers, "Duplicate layer", r.newId);
      },
      remove(id = st().activeLayerId) {
        if (id === BASE_LAYER_ID) return;
        const s = st();
        const sibs = s.layers.filter((l) => l.id !== id);
        commit(removeLayer(s.layers, id), "Delete layer", sibs[sibs.length - 1]?.id ?? BASE_LAYER_ID);
        s.setActiveLayer(st().layers.some((l) => l.id === s.activeLayerId) ? s.activeLayerId : BASE_LAYER_ID);
      },
      rename(id: string, name: string) {
        const n = name.trim().slice(0, 120);
        if (n) commit(patchLayer(st().layers, id, { name: n }), "Rename layer");
      },
      toggleVisible(id: string) {
        const l = findLayer(st().layers, id);
        if (l) commit(patchLayer(st().layers, id, { visible: !l.visible }), l.visible ? "Hide layer" : "Show layer");
      },
      toggleLocked(id: string) {
        const l = findLayer(st().layers, id);
        if (l) commit(patchLayer(st().layers, id, { locked: !l.locked }), l.locked ? "Unlock layer" : "Lock layer");
      },
      nudge(id: string, dir: 1 | -1) {
        commit(nudgeLayer(st().layers, id, dir), dir === 1 ? "Move layer up" : "Move layer down");
      },
      group(id = st().activeLayerId) {
        const r = groupLayer(st().layers, id, uniqueName(st().layers, "Group"));
        if (r.groupId) commit(r.layers, "Group layer", r.groupId);
      },
      ungroup(id = st().activeLayerId) {
        commit(ungroupLayer(st().layers, id), "Ungroup");
      },
      /** Live patch (no history) — call commitLive() afterwards. */
      patchLive(id: string, patch: Partial<LayerDoc>) {
        st().updateLayers((ls) => patchLayer(ls, id, patch));
      },
      commitLive(label: string) {
        st().commit(label);
      },
      patch(id: string, patch: Partial<LayerDoc>, label: string) {
        commit(patchLayer(st().layers, id, patch), label);
      },
    };
  }, []);
}
