"use client";

import { capturePointer } from "@/lib/pointer";

import { useRef } from "react";
import { useEditorStore } from "@/store/editorStore";

/** Draggable before/after divider. The renderer shows the original left of the line. */
export function SplitOverlay({ rect }: { rect: { left: number; top: number; width: number; height: number } }) {
  const splitX = useEditorStore((s) => s.splitX);
  const setSplitX = useEditorStore((s) => s.setSplitX);
  const dragging = useRef(false);
  const x = rect.left + rect.width * splitX;

  const move = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    e.stopPropagation();
    const parent = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    setSplitX((e.clientX - parent.left - rect.left) / rect.width);
  };

  return (
    <>
      <span
        className="pointer-events-none absolute rounded bg-black/60 px-2 py-0.5 text-xs text-white"
        style={{ left: rect.left + 8, top: rect.top + 8 }}
      >
        Before
      </span>
      <span
        className="pointer-events-none absolute rounded bg-black/60 px-2 py-0.5 text-xs text-white"
        style={{ left: rect.left + rect.width - 52, top: rect.top + 8 }}
      >
        After
      </span>
      <div
        role="slider"
        aria-label="Before/after divider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(splitX * 100)}
        tabIndex={0}
        className="absolute z-10 flex w-6 -translate-x-1/2 cursor-ew-resize justify-center focus-visible:outline-2 focus-visible:outline-ring"
        style={{ left: x, top: rect.top, height: rect.height }}
        onPointerDown={(e) => {
          e.stopPropagation();
          dragging.current = true;
          capturePointer(e);
        }}
        onPointerMove={move}
        onPointerUp={(e) => {
          e.stopPropagation();
          dragging.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setSplitX(splitX - 0.02);
          if (e.key === "ArrowRight") setSplitX(splitX + 0.02);
        }}
      >
        <div className="h-full w-0.5 bg-white shadow-[0_0_4px_rgba(0,0,0,0.8)]" />
        <div className="absolute top-1/2 size-6 -translate-y-1/2 rounded-full border-2 border-white bg-black/50" />
      </div>
    </>
  );
}
