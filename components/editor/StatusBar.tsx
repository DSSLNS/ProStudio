"use client";

import { Minus, Plus, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/store/editorStore";
import { useViewState } from "./viewState";
import { outputSize } from "@/engine/image/transform";

const PRESETS = [0.25, 0.5, 1, 2, 4];

export function StatusBar() {
  const project = useEditorStore((s) => s.project);
  const geometry = useEditorStore((s) => s.recipe.geometry);
  const zoom = useEditorStore((s) => s.zoom);
  const fitZoom = useEditorStore((s) => s.fitZoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const pointer = useViewState((s) => s.pointer);
  const renderInfo = useViewState((s) => s.renderInfo);
  const z = zoom ?? fitZoom;
  const out = project ? outputSize(project.width, project.height, geometry) : null;

  return (
    <footer
      className="flex h-8 items-center gap-3 border-t border-border bg-card px-2 text-xs text-muted-foreground"
      aria-label="Status"
    >
      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size="icon-xs" aria-label="Zoom out" onClick={() => setZoom(z * 0.8)}>
          <Minus />
        </Button>
        <label className="sr-only" htmlFor="zoom-select">
          Zoom level
        </label>
        <select
          id="zoom-select"
          className="h-6 rounded bg-transparent px-1 font-mono text-xs text-foreground hover:bg-muted"
          value={zoom === null ? "fit" : String(zoom)}
          onChange={(e) => setZoom(e.target.value === "fit" ? null : parseFloat(e.target.value))}
        >
          <option value="fit">Fit ({Math.round(fitZoom * 100)}%)</option>
          {PRESETS.map((p) => (
            <option key={p} value={String(p)}>
              {p * 100}%
            </option>
          ))}
          {zoom !== null && !PRESETS.includes(zoom) && <option value={String(zoom)}>{Math.round(zoom * 100)}%</option>}
        </select>
        <Button variant="ghost" size="icon-xs" aria-label="Zoom in" onClick={() => setZoom(z * 1.25)}>
          <Plus />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Fit to screen" onClick={() => setZoom(null)}>
          <Scan />
        </Button>
      </div>
      {out && (
        <span className="font-mono" data-testid="output-size">
          {out.width} × {out.height} px
        </span>
      )}
      <span className="ml-auto hidden font-mono sm:inline" aria-live="off">
        {pointer
          ? `x ${pointer.x}  y ${pointer.y}${pointer.rgb ? `  R ${pointer.rgb[0]} G ${pointer.rgb[1]} B ${pointer.rgb[2]}` : ""}`
          : ""}
      </span>
      {renderInfo && <span className="hidden md:inline">{renderInfo.backend === "webgl2" ? "GPU" : "CPU"}</span>}
    </footer>
  );
}
