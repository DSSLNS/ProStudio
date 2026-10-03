"use client";

import { useEffect, useRef } from "react";
import { Section } from "./controls/AdjustmentSlider";
import { useEditorStore } from "@/store/editorStore";
import { useViewState } from "./viewState";
import { editorRuntime } from "./editorRuntime";
import { formatBytes, formatMegapixels, RAW_FORMATS } from "@/lib/fileUtils";
import { formatShutter } from "@/lib/imageMetadata";
import { outputSize } from "@/engine/image/transform";

export function HistogramView() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const version = useViewState((s) => s.histogramVersion);
  useEffect(() => {
    const t = window.setTimeout(() => {
      const h = editorRuntime.histogram();
      const c = canvas.current;
      if (!h || !c) return;
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, c.width, c.height);
      let max = 1;
      for (let ch = 0; ch < 3; ch++) for (let i = 2; i < 254; i++) max = Math.max(max, h[ch * 256 + i]);
      ctx.globalCompositeOperation = "lighter";
      const colors = ["rgba(239,68,68,0.7)", "rgba(34,197,94,0.7)", "rgba(59,130,246,0.7)"];
      for (let ch = 0; ch < 3; ch++) {
        ctx.fillStyle = colors[ch];
        ctx.beginPath();
        ctx.moveTo(0, c.height);
        for (let i = 0; i < 256; i++)
          ctx.lineTo((i / 255) * c.width, c.height - Math.min(1, h[ch * 256 + i] / max) * c.height);
        ctx.lineTo(c.width, c.height);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }, 120);
    return () => window.clearTimeout(t);
  }, [version]);
  return (
    <canvas
      ref={canvas}
      width={256}
      height={80}
      className="h-20 w-full rounded bg-black/40"
      role="img"
      aria-label="RGB histogram of the edited image"
    />
  );
}

export function InfoPanel() {
  const project = useEditorStore((s) => s.project);
  const geometry = useEditorStore((s) => s.recipe.geometry);
  const preview = useEditorStore((s) => s.preview);
  const renderInfo = useViewState((s) => s.renderInfo);
  const sourceFormat = useEditorStore((s) => s.sourceFormat);
  const isRaw = !!sourceFormat && RAW_FORMATS.includes(sourceFormat);
  if (!project) return null;
  const m = project.metadata;
  const out = outputSize(project.width, project.height, geometry);
  const rows: [string, string | undefined][] = [
    ["Original", formatMegapixels(project.width, project.height)],
    ["Output", formatMegapixels(out.width, out.height)],
    ["File", `${project.sourceName} · ${formatBytes(project.sourceSize)}`],
    [
      "Preview",
      preview ? `${preview.bitmap.width} × ${preview.bitmap.height} (${Math.round(preview.scale * 100)}%)` : undefined,
    ],
    [
      "Renderer",
      renderInfo
        ? `${renderInfo.backend === "webgl2" ? "GPU (WebGL2)" : "CPU fallback"} · ${renderInfo.ms.toFixed(0)} ms`
        : undefined,
    ],
    ["Camera", [m?.make, m?.model].filter(Boolean).join(" ") || undefined],
    ["Lens", m?.lens],
    [
      "Exposure",
      m?.exposureTime
        ? `${formatShutter(m.exposureTime)}${m.fNumber ? ` · f/${m.fNumber}` : ""}${m.iso ? ` · ISO ${m.iso}` : ""}`
        : undefined,
    ],
    ["Focal length", m?.focalLength ? `${m.focalLength} mm` : undefined],
    ["Date", m?.dateTaken ? new Date(m.dateTaken).toLocaleString() : undefined],
    ["Location", m?.hasGps ? "Present (can be removed on export)" : undefined],
    ["Color profile", m?.colorSpace],
    [
      "RAW pipeline",
      isRaw ? "LibRaw (WebAssembly): AHD demosaic · as-shot white balance · highlight blend · camera matrix → sRGB. Original RAW kept unmodified." : undefined,
    ],
    ["Lens correction", isRaw ? "Not applied — no lens profile database is available in the browser." : undefined],
  ];
  return (
    <div>
      <Section title="Histogram">
        <HistogramView />
      </Section>
      <Section title="Image information">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="break-words">{v}</dd>
              </div>
            ))}
        </dl>
      </Section>
    </div>
  );
}
