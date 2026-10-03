"use client";

import { capturePointer } from "@/lib/pointer";

import { useRef } from "react";
import { useEditorStore } from "@/store/editorStore";
import { patchLayer } from "@/engine/layers/layerOps";
import type { LayerDoc, Placement } from "@/types/layers";
import { editorRuntime } from "../editorRuntime";
import { clientToFrame } from "../tools/coords";

type Placed = Extract<LayerDoc, { placement: Placement }>;
type Rect = { left: number; top: number; width: number; height: number };

/** Move (drag) and resize (corner handles) the active image/text/shape layer. */
export function LayerTransformOverlay({ rect }: { rect: Rect }) {
  const layer = useEditorStore((s) => s.layers.find((l) => l.id === s.activeLayerId));
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "move" | "scale"; start: [number, number]; orig: Placement; layer: Placed } | null>(null);
  const v = editorRuntime.view;
  if (!layer || !("placement" in layer) || !v || !layer.visible) return null;
  const p = layer.placement;
  const k = (rect.width / v.width) * v.scale; // CSS px per frame px
  const cx = rect.left + (p.x - v.originX) * k;
  const cy = rect.top + (p.y - v.originY) * k;
  const w = p.width * k;
  const h = p.height * k;

  const begin = (e: React.PointerEvent<HTMLElement>) => {
    const mode = e.currentTarget.dataset.mode === "scale" ? "scale" : "move";
    if (layer.locked) return;
    e.stopPropagation();
    capturePointer(e);
    const container = root.current!.parentElement!;
    const pt = clientToFrame(e.clientX, e.clientY, container, rect);
    if (pt) drag.current = { mode, start: pt, orig: p, layer: layer as Placed };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    const pt = clientToFrame(e.clientX, e.clientY, root.current!.parentElement!, rect);
    if (!pt) return;
    let next: Placement;
    if (d.mode === "move") {
      next = { ...d.orig, x: d.orig.x + pt[0] - d.start[0], y: d.orig.y + pt[1] - d.start[1] };
    } else {
      const d0 = Math.hypot(d.start[0] - d.orig.x, d.start[1] - d.orig.y);
      const d1 = Math.hypot(pt[0] - d.orig.x, pt[1] - d.orig.y);
      const s = Math.max(0.02, d1 / Math.max(1, d0));
      next = { ...d.orig, width: Math.max(2, d.orig.width * s), height: Math.max(2, d.orig.height * s) };
    }
    const patch: Partial<LayerDoc> =
      d.layer.kind === "text" && d.mode === "scale"
        ? ({
            placement: next,
            fontSize: Math.max(1, d.layer.fontSize * (next.width / d.orig.width)),
          } as Partial<LayerDoc>)
        : ({ placement: next } as Partial<LayerDoc>);
    useEditorStore.getState().updateLayers((ls) => patchLayer(ls, d.layer.id, patch));
  };
  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    e.stopPropagation();
    useEditorStore.getState().commit(d.mode === "move" ? "Move layer" : "Resize layer");
  };

  return (
    <div ref={root} className="pointer-events-none absolute inset-0" data-testid="layer-transform">
      <div
        className="pointer-events-auto absolute cursor-move border border-dashed border-sky-400"
        style={{ left: cx - w / 2, top: cy - h / 2, width: w, height: h, transform: `rotate(${p.rotation}deg)` }}
        data-mode="move"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        role="group"
        aria-label={`${layer.name}: drag to move, drag a corner to resize`}
      >
        {(["nw", "ne", "sw", "se"] as const).map((c) => (
          <div
            key={c}
            className="absolute size-4 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize rounded-sm border-2 border-sky-400 bg-white sm:size-3"
            style={{ left: c.includes("w") ? 0 : "100%", top: c.includes("n") ? 0 : "100%" }}
            data-mode="scale"
            onPointerDown={begin}
            onPointerMove={move}
            onPointerUp={end}
            aria-hidden
          />
        ))}
      </div>
    </div>
  );
}
