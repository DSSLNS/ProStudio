"use client";

import { formatEv } from "@/camera/exposure";
import { useCameraStore } from "@/store/cameraStore";

const RANGE = 3;
const MIN_EV = -3;

/** Centre-weighted meter: EV offset of the preview's mean luminance from 18% grey. */
export function ExposureMeter() {
  const ev = useCameraStore((s) => s.analysis?.brightness.evOffset);
  if (ev === undefined) return null;
  const clamped = Math.max(-RANGE, Math.min(RANGE, ev));
  const pos = ((clamped + RANGE) / (2 * RANGE)) * 100;
  return (
    <div
      className="w-40 rounded-md bg-black/55 px-2 py-1 text-white"
      role="meter"
      aria-valuemin={MIN_EV}
      aria-valuemax={RANGE}
      aria-valuenow={Number(ev.toFixed(1))}
      aria-label="Exposure meter (EV from middle grey)"
    >
      <div className="relative h-4">
        {[-3, -2, -1, 0, 1, 2, 3].map((t) => (
          <span
            key={t}
            className={`absolute bottom-0 w-px ${t === 0 ? "h-3 bg-white" : "h-1.5 bg-white/60"}`}
            style={{ left: `${((t + RANGE) / (2 * RANGE)) * 100}%` }}
          />
        ))}
        <span className="absolute top-0 h-4 w-0.5 -translate-x-1/2 bg-brand" style={{ left: `${pos}%` }} />
      </div>
      <div className="flex justify-between text-[9px] text-white/70">
        <span>−3</span>
        <span className="font-medium text-white">{formatEv(ev)}</span>
        <span>+3</span>
      </div>
    </div>
  );
}
