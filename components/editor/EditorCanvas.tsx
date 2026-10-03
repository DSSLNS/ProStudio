"use client";

import { capturePointer } from "@/lib/pointer";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useEditorStore } from "@/store/editorStore";
import { outputSize } from "@/engine/image/transform";
import { usePreviewRenderer } from "./usePreviewRenderer";
import { useViewState } from "./viewState";
import { editorRuntime } from "./editorRuntime";
import { CropOverlay } from "./CropTool";
import { SplitOverlay } from "./SplitOverlay";
import { LayerTransformOverlay } from "./layers/LayerTransformOverlay";
import { PaintOverlay } from "./tools/PaintOverlay";
import { SelectionAnts, SelectionTool } from "./selection/SelectionOverlay";
import { RETOUCH_TOOL_IDS, SELECTION_TOOLS } from "@/store/editorStore";
import { cn } from "@/lib/utils";

export function EditorCanvas() {
  const container = useRef<HTMLDivElement>(null);
  const [glCanvas, setGlCanvas] = useState<HTMLCanvasElement | null>(null);
  const [cpuCanvas, setCpuCanvas] = useState<HTMLCanvasElement | null>(null);
  const [beforeCanvas, setBeforeCanvas] = useState<HTMLCanvasElement | null>(null);
  const backend = usePreviewRenderer(glCanvas, cpuCanvas, beforeCanvas);

  const project = useEditorStore((s) => s.project);
  const geometry = useEditorStore((s) => s.recipe.geometry);
  const tool = useEditorStore((s) => s.tool);
  const compare = useEditorStore((s) => s.compare);
  const zoomPref = useEditorStore((s) => s.zoom);
  const pan = useEditorStore((s) => s.pan);
  const fitZoom = useEditorStore((s) => s.fitZoom);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const unsupported = useViewState((v) => v.unsupported);

  const full = project
    ? outputSize(project.width, project.height, tool === "crop" ? { ...geometry, crop: null } : geometry)
    : { width: 1, height: 1 };

  // Track container size and compute the fit zoom.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!box.w || !box.h) return;
    const pad = tool === "crop" ? 0.82 : 0.94;
    useEditorStore.getState().setFitZoom(Math.min((box.w * pad) / full.width, (box.h * pad) / full.height));
  }, [box.w, box.h, full.width, full.height, tool]);

  const zoom = zoomPref ?? fitZoom;
  const dispW = full.width * zoom;
  const dispH = full.height * zoom;
  const left = (box.w - dispW) / 2 + (zoomPref === null ? 0 : pan.x);
  const top = (box.h - dispH) / 2 + (zoomPref === null ? 0 : pan.y);

  useEffect(() => {
    useViewState.getState().set({ displayRect: { left, top, width: dispW, height: dispH } });
  }, [left, top, dispW, dispH]);

  // Space bar = temporary hand tool.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        e.code === "Space" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target as HTMLElement)?.isContentEditable
      ) {
        if (!e.repeat) setSpaceHeld(true);
        if ((e.target as HTMLElement)?.tagName !== "BUTTON") e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const zoomAt = useCallback(
    (nextZoom: number, px: number, py: number) => {
      const s = useEditorStore.getState();
      const z = s.zoom ?? s.fitZoom;
      const nz = Math.max(0.02, Math.min(32, nextZoom));
      const curLeft = (box.w - full.width * z) / 2 + (s.zoom === null ? 0 : s.pan.x);
      const curTop = (box.h - full.height * z) / 2 + (s.zoom === null ? 0 : s.pan.y);
      const u = (px - curLeft) / z;
      const v = (py - curTop) / z;
      const nl = px - u * nz;
      const nt = py - v * nz;
      s.setZoom(nz);
      s.setPan({ x: nl - (box.w - full.width * nz) / 2, y: nt - (box.h - full.height * nz) / 2 });
    },
    [box.w, box.h, full.width, full.height],
  );

  // Wheel: ctrl/⌘/pinch → zoom about cursor; otherwise pan.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const s = useEditorStore.getState();
      if (e.ctrlKey || e.metaKey || e.altKey) {
        const z = s.zoom ?? s.fitZoom;
        zoomAt(z * Math.exp(-e.deltaY * 0.01), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        const z = s.zoom ?? s.fitZoom;
        if (s.zoom === null) s.setZoom(z);
        s.setPan({ x: s.pan.x - e.deltaX, y: s.pan.y - e.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Pointer gestures: drag to pan, two-finger pinch to zoom, zoom-tool clicks.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; zoom: number; cx: number; cy: number; panX: number; panY: number } | null>(
    null,
  );
  const panning = tool === "hand" || spaceHeld;

  const onPointerDown = (e: React.PointerEvent) => {
    if (tool === "crop" && !panning && e.pointerType !== "touch") return;
    const rect = container.current!.getBoundingClientRect();
    pointers.current.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    capturePointer(e);
    const s = useEditorStore.getState();
    if (s.zoom === null) s.setZoom(s.fitZoom);
    const pts = [...pointers.current.values()];
    const z = s.zoom ?? s.fitZoom;
    if (pts.length === 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      gesture.current = {
        dist,
        zoom: z,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
        panX: s.pan.x,
        panY: s.pan.y,
      };
    } else {
      gesture.current = { dist: 0, zoom: z, cx: pts[0].x, cy: pts[0].y, panX: s.pan.x, panY: s.pan.y };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = container.current!.getBoundingClientRect();
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    // Colour readout under the cursor.
    const rx = ((p.x - left) / dispW) * (editorRuntime.canvas?.width ?? 0);
    const ry = ((p.y - top) / dispH) * (editorRuntime.canvas?.height ?? 0);
    const inside = p.x >= left && p.y >= top && p.x < left + dispW && p.y < top + dispH;
    useViewState.getState().set({
      pointer:
        inside && project
          ? {
              x: Math.floor(((p.x - left) / dispW) * full.width),
              y: Math.floor(((p.y - top) / dispH) * full.height),
              rgb: editorRuntime.readColor(rx, ry),
            }
          : null,
    });

    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, p);
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    const s = useEditorStore.getState();
    if (pts.length >= 2 && g.dist > 0) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      s.setPan({ x: g.panX + (cx - g.cx), y: g.panY + (cy - g.cy) });
      zoomAt(g.zoom * (dist / g.dist), cx, cy);
      gesture.current = {
        ...g,
        dist,
        zoom: g.zoom * (dist / g.dist),
        cx,
        cy,
        panX: useEditorStore.getState().pan.x,
        panY: useEditorStore.getState().pan.y,
      };
    } else if (pts.length === 1 && (panning || tool === "move")) {
      s.setPan({ x: g.panX + (p.x - g.cx), y: g.panY + (p.y - g.cy) });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const start = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
    if (tool === "zoom" && start && start.dist === 0) {
      const rect = container.current!.getBoundingClientRect();
      const s = useEditorStore.getState();
      const z = s.zoom ?? s.fitZoom;
      zoomAt(e.altKey ? z / 2 : z * 2, e.clientX - rect.left, e.clientY - rect.top);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool === "crop") return;
    const s = useEditorStore.getState();
    const rect = container.current!.getBoundingClientRect();
    if (s.zoom === null || Math.abs(s.zoom - s.fitZoom) < 1e-3) zoomAt(1, e.clientX - rect.left, e.clientY - rect.top);
    else s.setZoom(null);
  };

  const canvasStyle: CSSProperties = {
    position: "absolute",
    left,
    top,
    width: dispW,
    height: dispH,
    imageRendering: zoom >= 2 ? "pixelated" : "auto",
  };

  const cursor = panning
    ? "grab"
    : tool === "zoom"
      ? "zoom-in"
      : tool === "crop"
        ? "default"
        : zoom > fitZoom * 1.01
          ? "grab"
          : "default";

  return (
    <div
      ref={container}
      className="relative h-full w-full touch-none select-none overflow-hidden bg-[oklch(0.13_0.004_260)]"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => useViewState.getState().set({ pointer: null })}
      onDoubleClick={onDoubleClick}
      data-testid="editor-canvas"
      role="img"
      aria-label={project ? `Edited preview of ${project.name}` : "Editor canvas"}
    >
      {compare === "side-by-side" && tool !== "crop" ? (
        <div className="absolute inset-0 grid grid-cols-2 gap-2 p-3">
          <figure className="relative flex min-h-0 flex-col items-center justify-center">
            <canvas
              ref={setBeforeCanvas}
              className="bg-checker max-h-full max-w-full object-contain"
              aria-label="Before"
            />
            <figcaption className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
              Before
            </figcaption>
          </figure>
          <figure className="relative flex min-h-0 flex-col items-center justify-center">
            <canvas
              ref={setGlCanvas}
              className={cn("bg-checker max-h-full max-w-full object-contain", backend === "cpu" && "hidden")}
              data-testid="preview-canvas"
            />
            <canvas
              ref={setCpuCanvas}
              className={cn("bg-checker max-h-full max-w-full object-contain", backend !== "cpu" && "hidden")}
            />
            <figcaption className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
              After
            </figcaption>
          </figure>
        </div>
      ) : (
        <>
          <canvas
            ref={setGlCanvas}
            style={canvasStyle}
            className={cn("bg-checker shadow-2xl", backend === "cpu" && "hidden")}
            data-testid="preview-canvas"
          />
          <canvas
            ref={setCpuCanvas}
            style={canvasStyle}
            className={cn("bg-checker shadow-2xl", backend !== "cpu" && "hidden")}
          />
          {compare === "split" && tool !== "crop" && <SplitOverlay rect={{ left, top, width: dispW, height: dispH }} />}
          {tool !== "crop" && <SelectionAnts rect={{ left, top, width: dispW, height: dispH }} />}
          {SELECTION_TOOLS.includes(tool) && !spaceHeld && <SelectionTool rect={{ left, top, width: dispW, height: dispH }} />}
          {(["brush", "pencil", "eraser", "bg-eraser", "gradient", "select-brush"].includes(tool) || RETOUCH_TOOL_IDS.includes(tool)) && !spaceHeld && (
            <PaintOverlay rect={{ left, top, width: dispW, height: dispH }} />
          )}
          {tool === "move" && compare === "off" && (
            <LayerTransformOverlay rect={{ left, top, width: dispW, height: dispH }} />
          )}
          {tool === "crop" && project && <CropOverlay rect={{ left, top, width: dispW, height: dispH }} frame={full} />}
        </>
      )}
      {unsupported.length > 0 && (
        <p role="status" className="absolute inset-x-0 top-2 mx-auto w-fit max-w-[90%] rounded bg-amber-500/90 px-3 py-1 text-xs text-black">
          Not shown with the CPU renderer: {unsupported.join(", ")}. Enable GPU acceleration in Settings.
        </p>
      )}
    </div>
  );
}
