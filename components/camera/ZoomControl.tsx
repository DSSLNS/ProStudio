"use client";

import { supportsZoom } from "@/camera/capabilities";
import { snapToRange } from "@/camera/exposure";
import { useCameraStore } from "@/store/cameraStore";
import { useCameraApi } from "./CameraContext";
import { cn } from "@/lib/utils";

/** Quick zoom chips: device zoom stops when the camera reports a zoom range, otherwise digital zoom. */
export function ZoomControl() {
  const api = useCameraApi();
  const caps = useCameraStore((s) => s.capabilities);
  const deviceZoom = useCameraStore((s) => s.settings.zoom);
  const digital = useCameraStore((s) => s.digitalZoom);
  const set = useCameraStore((s) => s.set);
  if (!caps) return null;
  const hw = supportsZoom(caps) ? caps.zoom! : null;
  const stops = hw ? [1, 2, 3, 5].filter((z) => z >= hw.min && z <= hw.max) : [1, 2, 4];
  if (hw && !stops.includes(hw.min)) stops.unshift(hw.min);
  const current = hw ? (deviceZoom ?? hw.min) : digital;
  return (
    <div
      className="flex items-center gap-1 rounded-full bg-black/50 p-1"
      role="group"
      aria-label={hw ? "Zoom (device)" : "Digital zoom"}
    >
      {stops.map((z) => {
        const active = Math.abs(current - z) < 0.05;
        return (
          <button
            key={z}
            type="button"
            aria-pressed={active}
            aria-label={`${hw ? "Zoom (device)" : "Digital zoom"} ${z}×`}
            onClick={() => (hw ? void api.applySettings({ zoom: snapToRange(z, hw) }, "Zoom") : set("digitalZoom", z))}
            className={cn(
              "min-w-9 rounded-full px-2 py-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand",
              active ? "bg-white text-black" : "text-white hover:bg-white/15",
            )}
          >
            {Number.isInteger(z) ? z : z.toFixed(1)}×
          </button>
        );
      })}
      {!hw && <span className="px-1 text-[10px] text-white/60">digital</span>}
    </div>
  );
}
