"use client";

import { useEffect, useRef } from "react";
import { useCameraStore } from "@/store/cameraStore";

function draw(ctx: CanvasRenderingContext2D, hist: Uint32Array, w: number, h: number, color: string) {
  let max = 1;
  for (let i = 2; i < 254; i++) if (hist[i] > max) max = hist[i];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i < 256; i++) {
    const v = Math.min(1, Math.sqrt(hist[i] / max));
    ctx.lineTo((i / 255) * w, h - v * h);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
}

/** Live luma or RGB histogram of the preview (from the analysis frame). */
export function Histogram({ mode }: { mode: "luma" | "rgb" }) {
  const hist = useCameraStore((s) => s.analysis?.stats.histograms);
  const clip = useCameraStore((s) => s.analysis?.stats);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || !hist) return;
    const { width: w, height: h } = c;
    ctx.clearRect(0, 0, w, h);
    if (mode === "luma") draw(ctx, hist.luma, w, h, "rgba(255,255,255,0.8)");
    else {
      ctx.globalCompositeOperation = "lighter";
      draw(ctx, hist.r, w, h, "rgba(255,60,60,0.7)");
      draw(ctx, hist.g, w, h, "rgba(60,255,60,0.7)");
      draw(ctx, hist.b, w, h, "rgba(70,110,255,0.7)");
      ctx.globalCompositeOperation = "source-over";
    }
  }, [hist, mode]);

  const hiClip = (clip?.highlightClip ?? 0) > 0.01;
  const loClip = (clip?.shadowClip ?? 0) > 0.05;
  return (
    <figure
      className="relative rounded-md bg-black/55 p-1"
      aria-label={`${mode === "luma" ? "Luminance" : "RGB"} histogram`}
    >
      <canvas ref={ref} width={128} height={56} className="block h-14 w-32" aria-hidden />
      <figcaption className="flex justify-between px-0.5 text-[9px] leading-tight text-white/70">
        <span className={loClip ? "font-semibold text-sky-300" : ""}>{loClip ? "▲ Shadows clip" : ""}</span>
        <span className={hiClip ? "font-semibold text-amber-300" : ""}>{hiClip ? "Highlights clip ▲" : ""}</span>
      </figcaption>
    </figure>
  );
}
