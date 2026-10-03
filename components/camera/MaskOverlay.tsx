"use client";

import { useEffect, useRef } from "react";
import { useCameraStore } from "@/store/cameraStore";

/**
 * Zebra / clipping / focus-peaking overlay. Masks are computed on the low-res
 * analysis frame (~160 px wide) and scaled up, so they are indicative only.
 */
export function MaskOverlay() {
  const masks = useCameraStore((s) => s.masks);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c || !masks) return;
    const { width: w, height: h } = masks;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const i = p * 4;
        if (masks.peaking?.[p]) {
          d[i] = 255;
          d[i + 1] = 40;
          d[i + 2] = 40;
          d[i + 3] = 230;
        } else if (masks.zebra?.[p]) {
          // Diagonal stripes so the warning doesn't rely on colour alone.
          const on = (x + y) % 4 < 2;
          d[i] = d[i + 1] = d[i + 2] = on ? 255 : 0;
          d[i + 3] = on ? 220 : 120;
        } else if (masks.shadows?.[p]) {
          d[i] = 40;
          d[i + 1] = 90;
          d[i + 2] = 255;
          d[i + 3] = (x + y) % 4 < 2 ? 210 : 90;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [masks]);

  if (!masks) return null;
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
