"use client";

import { capturePointer } from "@/lib/pointer";

import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/store/editorStore";
import { useToolStore } from "@/store/toolStore";
import { modeFromModifiers } from "@/engine/selection/selection";
import { rasterizeMask } from "@/engine/layers/raster";
import { editorRuntime } from "../editorRuntime";
import { clientToFrame, frameToCss, type DisplayRect } from "../tools/coords";
import { applySelectionOp, magicWandAt } from "./selectionActions";

type Pt = [number, number];

/** Interaction for rectangle / ellipse / lasso / polygonal lasso / magic wand. */
export function SelectionTool({ rect }: { rect: DisplayRect }) {
  const tool = useEditorStore((s) => s.tool);
  const baseMode = useToolStore((s) => s.selectionMode);
  const root = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ a: Pt; b: Pt } | null>(null);
  const [path, setPath] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const down = useRef(false);

  const frame = (e: { clientX: number; clientY: number }) => clientToFrame(e.clientX, e.clientY, root.current!.parentElement!, rect);
  const mode = (e: { shiftKey: boolean; altKey: boolean }) => modeFromModifiers(baseMode, e.shiftKey, e.altKey);

  // Polygonal lasso: Escape cancels, Enter closes, Backspace removes the last point.
  useEffect(() => {
    if (tool !== "polygon") return;
    const onKey = (e: KeyboardEvent) => {
      if (!path.length) return;
      if (e.key === "Escape") setPath([]);
      if (e.key === "Backspace") setPath((p) => p.slice(0, -1));
      if (e.key === "Enter" && path.length >= 3) {
        applySelectionOp({ type: "polygon", mode: "add", points: path.flat() }, mode(e));
        setPath([]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = frame(e);
    if (!p) return;
    e.stopPropagation();
    if (tool === "wand") {
      const v = editorRuntime.view;
      if (v) void magicWandAt((p[0] - v.originX) * v.scale, (p[1] - v.originY) * v.scale, mode(e));
      return;
    }
    if (tool === "polygon") {
      const close = path.length >= 3 && Math.hypot(...(frameToCss(...path[0], rect).map((v, i) => v - frameToCss(...p, rect)[i]) as [number, number])) < 10;
      if (close || e.detail >= 2) {
        const pts = close ? path : [...path, p];
        if (pts.length >= 3) applySelectionOp({ type: "polygon", mode: "add", points: pts.flat() }, mode(e));
        setPath([]);
      } else setPath([...path, p]);
      return;
    }
    capturePointer(e);
    down.current = true;
    if (tool === "lasso") setPath([p]);
    else setDrag({ a: p, b: p });
  };

  const onMove = (e: React.PointerEvent) => {
    const p = frame(e);
    if (!p) return;
    setHover(p);
    if (!down.current) return;
    if (tool === "lasso") setPath((pts) => [...pts, p]);
    else setDrag((d) => (d ? { ...d, b: p } : d));
  };

  const onUp = (e: React.PointerEvent) => {
    if (!down.current) return;
    down.current = false;
    if (tool === "lasso") {
      if (path.length >= 3) applySelectionOp({ type: "polygon", mode: "add", points: path.flat() }, mode(e));
      setPath([]);
      return;
    }
    if (!drag) return;
    const x = Math.min(drag.a[0], drag.b[0]);
    const y = Math.min(drag.a[1], drag.b[1]);
    const w = Math.abs(drag.b[0] - drag.a[0]);
    const h = Math.abs(drag.b[1] - drag.a[1]);
    setDrag(null);
    if (w < 2 || h < 2) {
      // A click without a drag deselects (new mode), like most editors.
      if (mode(e) === "new") useEditorStore.getState().setSelection(null);
      return;
    }
    applySelectionOp(
      tool === "select-ellipse" ? { type: "ellipse", mode: "add", cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 } : { type: "rect", mode: "add", x, y, w, h },
      mode(e),
    );
  };

  const css = (p: Pt) => frameToCss(p[0], p[1], rect);
  let preview: React.ReactNode = null;
  if (drag) {
    const [ax, ay] = css(drag.a);
    const [bx, by] = css(drag.b);
    const x = Math.min(ax, bx);
    const y = Math.min(ay, by);
    const w = Math.abs(bx - ax);
    const h = Math.abs(by - ay);
    preview =
      tool === "select-ellipse" ? (
        <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} className="ants" />
      ) : (
        <rect x={x} y={y} width={w} height={h} className="ants" />
      );
  } else if (path.length) {
    const pts = [...path, ...(tool === "polygon" && hover ? [hover] : [])].map(css);
    preview = <polyline points={pts.map((p) => p.join(",")).join(" ")} className="ants" fill="none" />;
  }

  return (
    <div
      ref={root}
      className="absolute inset-0 touch-none"
      style={{ cursor: "crosshair" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      data-testid="selection-tool"
    >
      <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
        {preview}
      </svg>
    </div>
  );
}

/** Marching ants around the current selection (any tool). Edges come from the real rasterised selection. */
export function SelectionAnts({ rect }: { rect: DisplayRect }) {
  const selection = useEditorStore((s) => s.selection);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [edges, setEdges] = useState<{ xs: Int32Array; ys: Int32Array; w: number; h: number } | null>(null);

  useEffect(() => {
    const v = editorRuntime.view;
    if (!selection || !v) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing derived outline when the selection goes away
      setEdges(null);
      return;
    }
    let cancelled = false;
    void editorRuntime.assets.ensure(selection.ops.flatMap((o) => (o.type === "raster" ? [o.assetId] : []))).then(() => {
      if (cancelled) return;
      // Edge detection at (at most) ~1200px so ants stay cheap on big previews.
      const s = Math.min(1, 1200 / Math.max(v.width, v.height));
      const view = { ...v, scale: v.scale * s, width: Math.max(1, Math.round(v.width * s)), height: Math.max(1, Math.round(v.height * s)) };
      const c = rasterizeMask(selection, view, editorRuntime.assets);
      const a = c.getContext("2d")!.getImageData(0, 0, view.width, view.height).data;
      const w = view.width;
      const h = view.height;
      const sel = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && a[(y * w + x) * 4 + 3] >= 128;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (sel(x, y) && (!sel(x - 1, y) || !sel(x + 1, y) || !sel(x, y - 1) || !sel(x, y + 1))) {
            xs.push(x);
            ys.push(y);
          }
      setEdges({ xs: Int32Array.from(xs), ys: Int32Array.from(ys), w, h });
    });
    return () => {
      cancelled = true;
    };
  }, [selection, rect.width, rect.height]);

  useEffect(() => {
    if (!edges || !canvas.current) return;
    const c = canvas.current;
    c.width = edges.w;
    c.height = edges.h;
    const ctx = c.getContext("2d")!;
    let phase = 0;
    const img = ctx.createImageData(edges.w, edges.h);
    const draw = () => {
      img.data.fill(0);
      for (let i = 0; i < edges.xs.length; i++) {
        const x = edges.xs[i];
        const y = edges.ys[i];
        const v = ((x + y + phase) >> 2) & 1 ? 255 : 0;
        const p = (y * edges.w + x) * 4;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
        img.data[p + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      phase = (phase + 1) & 7;
    };
    draw();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = reduce ? 0 : window.setInterval(draw, 120);
    return () => window.clearInterval(id);
  }, [edges]);

  if (!selection || !edges) return null;
  return (
    <canvas
      ref={canvas}
      className="pointer-events-none absolute"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, imageRendering: "pixelated" }}
      data-testid="selection-ants"
      aria-label="Selection outline"
      role="img"
    />
  );
}
