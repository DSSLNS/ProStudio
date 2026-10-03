"use client";

import { Loader2 } from "lucide-react";
import { useCameraStore } from "@/store/cameraStore";
import { ExposureMeter } from "./ExposureMeter";
import { Histogram } from "./Histogram";
import { SceneIndicator } from "./SceneIndicator";

/** Heads-up info drawn over the viewfinder: scene label, histogram, meter, status. */
export function CameraHud({ showScene }: { showScene: boolean }) {
  const status = useCameraStore((s) => s.status);
  const histogram = useCameraStore((s) => s.overlays.histogram);
  const meter = useCameraStore((s) => s.overlays.exposureMeter);
  const kind = useCameraStore((s) => s.captureKind);
  const capturing = useCameraStore((s) => s.capturing);
  return (
    <>
      <div className="pointer-events-none absolute top-2 left-2 z-10 flex flex-col gap-1.5">
        {histogram !== "off" && <Histogram mode={histogram} />}
        {meter && <ExposureMeter />}
      </div>
      <div className="pointer-events-none absolute top-2 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1">
        {kind !== "single" && (
          <span className="rounded-full bg-black/60 px-3 py-1 text-xs text-white">
            {kind === "night" ? "Night (multi-frame) — hold still" : "HDR — 3 bracketed frames, hold still"}
          </span>
        )}
      </div>
      {showScene && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-10 -translate-x-1/2">
          <SceneIndicator />
        </div>
      )}
      {status === "starting" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center" role="status">
          <Loader2 className="size-8 animate-spin text-white/70" aria-hidden />
          <span className="sr-only">Starting camera…</span>
        </div>
      )}
      {capturing && (
        <div className="pointer-events-none absolute inset-0 z-10 bg-white/10" role="status" aria-live="assertive">
          <span className="sr-only">Capturing…</span>
        </div>
      )}
    </>
  );
}
