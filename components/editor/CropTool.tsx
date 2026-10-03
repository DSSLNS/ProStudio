"use client";

import { capturePointer } from "@/lib/pointer";

import { useEffect, useRef } from "react";
import { Check, X } from "lucide-react";
import { useEditorStore } from "@/store/editorStore";
import { useViewState } from "./viewState";
import { Button } from "@/components/ui/button";
import type { CropRect } from "@/types/edit";

type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const FULL: CropRect = { x: 0, y: 0, width: 1, height: 1 };
const MIN = 0.02;

/** Constrain a crop to the frame and (optionally) a pixel aspect ratio. */
export function constrainCrop(
  c: CropRect,
  aspect: number | null,
  frame: { width: number; height: number },
  anchor: Handle = "move",
): CropRect {
  let { x, y, width, height } = c;
  width = Math.max(MIN, Math.min(1, width));
  height = Math.max(MIN, Math.min(1, height));
  if (aspect) {
    const normAspect = aspect * (frame.height / frame.width); // width/height in normalised units
    if (anchor === "n" || anchor === "s") width = height * normAspect;
    else height = width / normAspect;
    if (width > 1) {
      width = 1;
      height = width / normAspect;
    }
    if (height > 1) {
      height = 1;
      width = height * normAspect;
    }
  }
  x = Math.max(0, Math.min(1 - width, x));
  y = Math.max(0, Math.min(1 - height, y));
  return { x, y, width, height };
}

/** Largest centred crop with the given pixel aspect inside the frame. */
export function cropForAspect(aspect: number | null, frame: { width: number; height: number }): CropRect {
  if (!aspect) return FULL;
  const frameAspect = frame.width / frame.height;
  if (aspect > frameAspect) {
    const h = frameAspect / aspect;
    return { x: 0, y: (1 - h) / 2, width: 1, height: h };
  }
  const w = aspect / frameAspect;
  return { x: (1 - w) / 2, y: 0, width: w, height: 1 };
}

export function applyDraftCrop() {
  const draft = useViewState.getState().draftCrop;
  const s = useEditorStore.getState();
  const isFull = !draft || (draft.x < 1e-4 && draft.y < 1e-4 && draft.width > 0.9999 && draft.height > 0.9999);
  s.applyRecipe("Crop", (r) => {
    r.geometry.crop = isFull ? null : draft;
  });
  useViewState.getState().set({ draftCrop: null });
  s.setTool("move");
}

export function cancelCrop() {
  useViewState.getState().set({ draftCrop: null });
  useEditorStore.getState().setTool("move");
}

export function CropOverlay({
  rect,
  frame,
}: {
  rect: { left: number; top: number; width: number; height: number };
  frame: { width: number; height: number };
}) {
  const crop = useEditorStore((s) => s.recipe.geometry.crop);
  const draft = useViewState((s) => s.draftCrop);
  const aspect = useViewState((s) => s.cropAspect);
  const drag = useRef<{ handle: Handle; start: CropRect; px: number; py: number } | null>(null);

  // Initialise the draft on entry (unless an aspect preset already set one); clear it on exit.
  useEffect(() => {
    if (!useViewState.getState().draftCrop) useViewState.getState().set({ draftCrop: crop ?? FULL });
    return () => useViewState.getState().set({ draftCrop: null });
  }, [crop]);

  const c = draft ?? crop ?? FULL;
  const box = {
    left: rect.left + c.x * rect.width,
    top: rect.top + c.y * rect.height,
    width: c.width * rect.width,
    height: c.height * rect.height,
  };

  const begin = (e: React.PointerEvent<HTMLElement>) => {
    const handle = (e.currentTarget.dataset.handle ?? "move") as Handle;
    e.stopPropagation();
    capturePointer(e);
    drag.current = { handle, start: c, px: e.clientX, py: e.clientY };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    const dx = (e.clientX - d.px) / rect.width;
    const dy = (e.clientY - d.py) / rect.height;
    const s = d.start;
    let n: CropRect = { ...s };
    if (d.handle === "move") n = { ...s, x: s.x + dx, y: s.y + dy };
    else {
      if (d.handle.includes("w")) n = { ...n, x: s.x + dx, width: s.width - dx };
      if (d.handle.includes("e")) n = { ...n, width: s.width + dx };
      if (d.handle.includes("n")) n = { ...n, y: s.y + dy, height: s.height - dy };
      if (d.handle.includes("s")) n = { ...n, height: s.height + dy };
      if (n.width < MIN) n.width = MIN;
      if (n.height < MIN) n.height = MIN;
    }
    let out = constrainCrop(n, aspect, frame, d.handle);
    // Keep the opposite edge anchored when an aspect constraint changed the size.
    if (aspect && d.handle !== "move") {
      if (d.handle.includes("w")) out = { ...out, x: s.x + s.width - out.width };
      if (d.handle.includes("n")) out = { ...out, y: s.y + s.height - out.height };
      out = constrainCrop(out, aspect, frame, d.handle);
    }
    useViewState.getState().set({ draftCrop: out });
  };
  const end = () => {
    drag.current = null;
  };

  const handles: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const pos = (h: Handle) => ({
    left: h.includes("w") ? 0 : h.includes("e") ? "100%" : "50%",
    top: h.includes("n") ? 0 : h.includes("s") ? "100%" : "50%",
  });
  const cursor: Record<Handle, string> = {
    move: "move",
    n: "ns-resize",
    s: "ns-resize",
    e: "ew-resize",
    w: "ew-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
    nw: "nwse-resize",
    se: "nwse-resize",
  };

  return (
    <div className="absolute inset-0" data-testid="crop-overlay">
      {/* Dim outside the crop */}
      <div
        className="pointer-events-none absolute bg-black/55"
        style={{ left: rect.left, top: rect.top, width: rect.width, height: box.top - rect.top }}
      />
      <div
        className="pointer-events-none absolute bg-black/55"
        style={{
          left: rect.left,
          top: box.top + box.height,
          width: rect.width,
          height: rect.top + rect.height - box.top - box.height,
        }}
      />
      <div
        className="pointer-events-none absolute bg-black/55"
        style={{ left: rect.left, top: box.top, width: box.left - rect.left, height: box.height }}
      />
      <div
        className="pointer-events-none absolute bg-black/55"
        style={{
          left: box.left + box.width,
          top: box.top,
          width: rect.left + rect.width - box.left - box.width,
          height: box.height,
        }}
      />
      <div
        className="absolute border border-white/90"
        style={{ ...box, cursor: "move" }}
        data-handle="move"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onDoubleClick={(e) => {
          e.stopPropagation();
          applyDraftCrop();
        }}
        role="group"
        aria-label="Crop rectangle. Drag to move, use handles to resize, double-click or Enter to apply."
      >
        {/* Rule-of-thirds guides */}
        <div className="pointer-events-none absolute inset-0">
          {[1 / 3, 2 / 3].map((f) => (
            <div key={`v${f}`} className="absolute top-0 h-full w-px bg-white/40" style={{ left: `${f * 100}%` }} />
          ))}
          {[1 / 3, 2 / 3].map((f) => (
            <div key={`h${f}`} className="absolute left-0 h-px w-full bg-white/40" style={{ top: `${f * 100}%` }} />
          ))}
        </div>
        {handles.map((h) => (
          <div
            key={h}
            className="absolute size-5 -translate-x-1/2 -translate-y-1/2 touch-none rounded-sm border-2 border-white bg-black/40 sm:size-3.5"
            style={{ ...pos(h), cursor: cursor[h] }}
            data-handle={h}
            onPointerDown={begin}
            onPointerMove={move}
            onPointerUp={end}
            aria-hidden
          />
        ))}
      </div>
      <div
        className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="self-center rounded bg-black/60 px-2 py-1 font-mono text-xs text-white">
          {Math.round(c.width * frame.width)} × {Math.round(c.height * frame.height)}
        </span>
        <Button size="sm" variant="secondary" onClick={cancelCrop}>
          <X aria-hidden /> Cancel
        </Button>
        <Button size="sm" onClick={applyDraftCrop} data-testid="apply-crop">
          <Check aria-hidden /> Apply crop
        </Button>
      </div>
    </div>
  );
}
