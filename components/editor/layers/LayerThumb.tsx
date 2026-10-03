"use client";

import { useEffect, useRef } from "react";
import { Layers, SlidersHorizontal, Wand2 } from "lucide-react";
import type { LayerDoc, MaskDoc } from "@/types/layers";
import { useEditorStore } from "@/store/editorStore";
import {
  drawPaintOp,
  newCanvas,
  rasterizeImageLayer,
  rasterizeMask,
  rasterizeShapeLayer,
  rasterizeTextLayer,
} from "@/engine/layers/raster";
import type { View } from "@/engine/layers/view";
import { editorRuntime } from "../editorRuntime";
import { currentFrame } from "./useLayerActions";

const SIZE = 36;

function thumbView(): View {
  const f = currentFrame();
  const scale = SIZE / Math.max(f.width, f.height);
  return {
    originX: 0,
    originY: 0,
    scale,
    width: Math.max(1, Math.round(f.width * scale)),
    height: Math.max(1, Math.round(f.height * scale)),
  };
}

function draw(canvas: HTMLCanvasElement, layer: LayerDoc | null, mask: MaskDoc | null) {
  const v = thumbView();
  canvas.width = v.width;
  canvas.height = v.height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, v.width, v.height);
  const assets = editorRuntime.assets;
  if (mask) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, v.width, v.height);
    ctx.drawImage(rasterizeMask(mask, v, assets), 0, 0);
    return;
  }
  if (!layer) return;
  if (layer.kind === "base") {
    const p = useEditorStore.getState().preview;
    if (p) ctx.drawImage(p.bitmap, 0, 0, v.width, v.height);
    return;
  }
  let c: OffscreenCanvas | null = null;
  if (layer.kind === "image") c = rasterizeImageLayer(layer, v, assets);
  if (layer.kind === "text") c = rasterizeTextLayer(layer, v);
  if (layer.kind === "shape") c = rasterizeShapeLayer(layer, v);
  if (layer.kind === "paint") {
    const t = newCanvas(v.width, v.height);
    for (const op of layer.ops) drawPaintOp(t.ctx, op, v, assets);
    c = t.canvas;
  }
  if (c) ctx.drawImage(c, 0, 0);
}

/** Small preview of a layer's content (or its mask). Redrawn when the layer value changes. */
export function LayerThumb({ layer, mask = false }: { layer: LayerDoc; mask?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const target = mask ? layer.mask : null;
  useEffect(() => {
    const t = window.setTimeout(() => ref.current && draw(ref.current, mask ? null : layer, target), 60);
    return () => window.clearTimeout(t);
  }, [layer, target, mask]);
  const icon =
    !mask &&
    (layer.kind === "adjustment"
      ? SlidersHorizontal
      : layer.kind === "group"
        ? Layers
        : layer.kind === "retouch"
          ? Wand2
          : null);
  if (icon) {
    const Icon = icon;
    return (
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded border border-border bg-muted"
        aria-hidden
      >
        <Icon className="size-4 text-muted-foreground" />
      </span>
    );
  }
  return (
    <span
      className="bg-checker flex size-9 shrink-0 items-center justify-center overflow-hidden rounded border border-border"
      aria-hidden
    >
      <canvas ref={ref} className="max-h-full max-w-full" />
    </span>
  );
}
