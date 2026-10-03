"use client";

import { capturePointer } from "@/lib/pointer";

import { useRef, useState } from "react";
import { useEditorStore } from "@/store/editorStore";
import { useToolStore } from "@/store/toolStore";
import { StrokeSmoother } from "@/engine/layers/dabs";
import { beginBackgroundErase, beginGradient, beginPaintStroke, beginRetouchStroke, beginSelectionBrush, type LiveStroke } from "./strokeTargets";
import { RETOUCH_TOOL_IDS } from "@/store/editorStore";
import { useViewState } from "../viewState";
import { clientToFrame, cssPerFrame, frameToCss, type DisplayRect } from "./coords";

/** Pen reports real pressure; mouse reports 0.5 while pressed (treated as full); touch often reports 0 or 1. */
export function pressureOf(e: PointerEvent | React.PointerEvent): number {
  if (e.pointerType === "pen") return Math.max(0.01, e.pressure);
  return 1;
}

/**
 * Captures painting input for brush / pencil / eraser / gradient tools.
 * Uses coalesced pointer events for smooth strokes and only touches the
 * active layer's op list, so rendering stays incremental.
 */
export function PaintOverlay({ rect }: { rect: DisplayRect }) {
  const tool = useEditorStore((s) => s.tool);
  const size = useToolStore((s) => s.brush.size);
  const root = useRef<HTMLDivElement>(null);
  const stroke = useRef<LiveStroke | null>(null);
  const grad = useRef<{ g: NonNullable<ReturnType<typeof beginGradient>>; start: [number, number] } | null>(null);
  const smoother = useRef<StrokeSmoother | null>(null);
  const activePointer = useRef<number | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [line, setLine] = useState<[number, number, number, number] | null>(null);

  const toFrame = (e: { clientX: number; clientY: number }) => clientToFrame(e.clientX, e.clientY, root.current!.parentElement!, rect);

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (activePointer.current !== null) {
      // A second finger: abandon the stroke and let the canvas pinch-zoom.
      void stroke.current?.end(true);
      stroke.current = null;
      grad.current?.g.end(true);
      grad.current = null;
      activePointer.current = null;
      return;
    }
    const pt = toFrame(e);
    if (!pt) return;
    e.stopPropagation();
    capturePointer(e);
    activePointer.current = e.pointerId;
    if (tool === "gradient") {
      const g = beginGradient();
      if (g) grad.current = { g, start: pt };
      return;
    }
    const s =
      tool === "select-brush"
        ? beginSelectionBrush(e.altKey)
        : tool === "bg-eraser"
        ? beginBackgroundErase(pt[0], pt[1])
        : RETOUCH_TOOL_IDS.includes(tool)
          ? beginRetouchStroke(tool, pt[0], pt[1], e.altKey)
          : beginPaintStroke(tool as "brush" | "pencil" | "eraser");
    if (!s) {
      activePointer.current = null;
      return;
    }
    smoother.current = new StrokeSmoother(useToolStore.getState().smoothing);
    stroke.current = s;
    const [x, y, p] = smoother.current.push(pt[0], pt[1], pressureOf(e));
    s.add(x, y, p);
  };

  const onMove = (e: React.PointerEvent) => {
    const b = root.current!.getBoundingClientRect();
    setCursor({ x: e.clientX - b.left, y: e.clientY - b.top });
    if (activePointer.current !== e.pointerId) return;
    e.stopPropagation();
    if (grad.current) {
      const pt = toFrame(e);
      if (!pt) return;
      const [x0, y0] = grad.current.start;
      grad.current.g.update(x0, y0, pt[0], pt[1]);
      const a = frameToCss(x0, y0, rect);
      const c = frameToCss(pt[0], pt[1], rect);
      setLine([a[0], a[1], c[0], c[1]]);
      return;
    }
    const s = stroke.current;
    if (!s || !smoother.current) return;
    const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const pt = toFrame(ev);
      if (!pt) continue;
      const [x, y, p] = smoother.current.push(pt[0], pt[1], pressureOf(ev));
      s.add(x, y, p);
    }
  };

  const onUp = (e: React.PointerEvent) => {
    if (activePointer.current !== e.pointerId) return;
    e.stopPropagation();
    activePointer.current = null;
    void stroke.current?.end();
    stroke.current = null;
    grad.current?.g.end();
    grad.current = null;
    setLine(null);
  };

  const r = (size * cssPerFrame(rect)) / 2;
  const src = useViewState((v) => v.cloneSource);
  const srcCss = src && (tool === "clone" || tool === "heal") ? frameToCss(src[0], src[1], rect) : null;
  return (
    <div
      ref={root}
      className="absolute inset-0 touch-none"
      style={{ cursor: tool === "gradient" ? "crosshair" : "none" }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => setCursor(null)}
      data-testid="paint-overlay"
    >
      {cursor && tool !== "gradient" && (
        <div
          className="pointer-events-none absolute rounded-full border border-white mix-blend-difference"
          style={{ left: cursor.x - r, top: cursor.y - r, width: 2 * r, height: 2 * r }}
          aria-hidden
        />
      )}
      {srcCss && (
        <div className="pointer-events-none absolute" style={{ left: srcCss[0] - 8, top: srcCss[1] - 8 }} aria-hidden data-testid="clone-source">
          <div className="size-4 rounded-full border-2 border-white shadow-[0_0_2px_black]" />
          <div className="absolute left-1/2 top-[-4px] h-6 w-px -translate-x-1/2 bg-white" />
          <div className="absolute left-[-4px] top-1/2 h-px w-6 -translate-y-1/2 bg-white" />
        </div>
      )}
      {line && (
        <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          <line x1={line[0]} y1={line[1]} x2={line[2]} y2={line[3]} stroke="white" strokeWidth={2} strokeDasharray="6 4" />
          <circle cx={line[0]} cy={line[1]} r={5} fill="white" />
          <circle cx={line[2]} cy={line[3]} r={5} fill="none" stroke="white" strokeWidth={2} />
        </svg>
      )}
    </div>
  );
}
