"use client";

import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { LiveSlider } from "../controls/LiveSlider";
import { useEditorStore } from "@/store/editorStore";
import { useToolStore } from "@/store/toolStore";
import { RETOUCH_TOOL_IDS } from "@/store/editorStore";
import { useViewState } from "../viewState";

const pct = (v: number) => `${Math.round(v * 100)}%`;

function BrushOptions({ showColor }: { showColor: boolean }) {
  const t = useToolStore();
  const editingMask = useEditorStore((s) => s.editingMask);
  const b = t.brush;
  return (
    <>
      <div className="w-32">
        <LiveSlider label="Size" min={1} max={2000} value={b.size} format={(v) => `${Math.round(v)} px`} onLive={(size) => t.setBrush({ size })} testId="brush-size" />
      </div>
      <div className="flex gap-0.5 self-center">
        <Button size="xs" variant={b.hardness <= 0.05 ? "secondary" : "ghost"} onClick={() => t.setBrush({ hardness: 0 })} aria-pressed={b.hardness <= 0.05}>
          Soft
        </Button>
        <Button size="xs" variant={b.hardness >= 0.95 ? "secondary" : "ghost"} onClick={() => t.setBrush({ hardness: 1 })} aria-pressed={b.hardness >= 0.95}>
          Hard
        </Button>
      </div>
      <div className="w-24">
        <LiveSlider label="Hardness" min={0} max={1} step={0.01} value={b.hardness} format={pct} onLive={(hardness) => t.setBrush({ hardness })} />
      </div>
      <div className="w-24">
        <LiveSlider label="Opacity" min={0.01} max={1} step={0.01} value={b.opacity} format={pct} onLive={(opacity) => t.setBrush({ opacity })} />
      </div>
      <div className="w-24">
        <LiveSlider label="Flow" min={0.01} max={1} step={0.01} value={b.flow} format={pct} onLive={(flow) => t.setBrush({ flow })} />
      </div>
      <div className="w-24">
        <LiveSlider label="Spacing" min={0.02} max={1} step={0.01} value={b.spacing} format={pct} onLive={(spacing) => t.setBrush({ spacing })} />
      </div>
      <div className="w-24">
        <LiveSlider label="Smoothing" min={0} max={0.9} step={0.05} value={t.smoothing} format={pct} onLive={(smoothing) => t.set({ smoothing })} />
      </div>
      <label className="flex items-center gap-1.5 text-xs">
        <Switch checked={b.pressureSize} onCheckedChange={(pressureSize) => t.setBrush({ pressureSize })} aria-label="Pressure controls size" />
        Pressure
      </label>
      {editingMask ? (
        <Button size="xs" variant="outline" onClick={() => t.set({ maskPaint: t.maskPaint === "reveal" ? "hide" : "reveal" })} data-testid="mask-paint-mode">
          <ArrowLeftRight aria-hidden /> {t.maskPaint === "reveal" ? "Reveal (white)" : "Hide (black)"} · X
        </Button>
      ) : (
        showColor && (
          <label className="flex items-center gap-1.5 text-xs">
            Colour
            <input type="color" aria-label="Brush colour" className="h-7 w-9 rounded border border-input" value={t.color} onChange={(e) => t.set({ color: e.target.value })} />
          </label>
        )
      )}
    </>
  );
}

function SelectionOptions({ wand }: { wand: boolean }) {
  const t = useToolStore();
  const hasSelection = useEditorStore((s) => !!s.selection);
  const modes = [
    ["new", "New"],
    ["add", "Add"],
    ["subtract", "Subtract"],
    ["intersect", "Intersect"],
  ] as const;
  return (
    <div className="flex items-center gap-3 py-1 text-xs">
      <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Selection mode">
        {modes.map(([m, label]) => (
          <Button key={m} size="xs" role="radio" aria-checked={t.selectionMode === m} variant={t.selectionMode === m ? "secondary" : "ghost"} onClick={() => t.set({ selectionMode: m })}>
            {label}
          </Button>
        ))}
      </div>
      {wand && (
        <>
          <div className="w-32">
            <LiveSlider label="Tolerance" min={0} max={100} value={t.wandTolerance} onLive={(wandTolerance) => t.set({ wandTolerance })} testId="wand-tolerance" />
          </div>
          <label className="flex items-center gap-1.5">
            <Switch checked={t.wandContiguous} onCheckedChange={(wandContiguous) => t.set({ wandContiguous })} aria-label="Contiguous" />
            Contiguous
          </label>
        </>
      )}
      <span className="text-muted-foreground">
        {hasSelection ? "Shift adds · Alt subtracts · Shift+Alt intersects · Esc/Mod+D deselects" : "Shift adds · Alt subtracts · Shift+Alt intersects"}
      </span>
    </div>
  );
}

function RetouchOptions({ tool }: { tool: string }) {
  const t = useToolStore();
  const source = useViewState((v) => v.cloneSource);
  const picking = useViewState((v) => v.pickingSource);
  const usesSource = tool === "clone" || tool === "heal";
  const usesStrength = ["dodge", "burn", "smudge", "blur-brush", "sharpen-brush"].includes(tool);
  return (
    <>
      <BrushOptions showColor={false} />
      {usesStrength && (
        <div className="w-28">
          <LiveSlider label="Strength" min={0.05} max={1} step={0.01} value={t.retouchStrength} format={pct} onLive={(retouchStrength) => t.set({ retouchStrength })} testId="retouch-strength" />
        </div>
      )}
      {(tool === "dodge" || tool === "burn") && (
        <label className="flex items-center gap-1.5 text-xs">
          Range
          <select className="h-7 rounded border border-input bg-transparent text-xs" value={t.dodgeRange} onChange={(e) => t.set({ dodgeRange: e.target.value as typeof t.dodgeRange })} aria-label="Tonal range">
            <option value="shadows">Shadows</option>
            <option value="midtones">Midtones</option>
            <option value="highlights">Highlights</option>
          </select>
        </label>
      )}
      {tool === "dust" && (
        <div className="w-28">
          <LiveSlider label="Threshold" min={0.02} max={0.5} step={0.01} value={t.dustThreshold} format={pct} onLive={(dustThreshold) => t.set({ dustThreshold })} />
        </div>
      )}
      {usesSource && (
        <>
          <label className="flex items-center gap-1.5 text-xs">
            <Switch checked={t.cloneAligned} onCheckedChange={(cloneAligned) => t.set({ cloneAligned })} aria-label="Aligned" />
            Aligned
          </label>
          <Button size="xs" variant={picking ? "secondary" : "outline"} aria-pressed={picking} onClick={() => useViewState.getState().set({ pickingSource: !picking })} data-testid="set-source">
            {picking ? "Tap the source…" : source ? "Change source" : "Set source"}
          </Button>
          <span className="text-muted-foreground">{source ? "Alt-click to change the source" : "Alt-click to set a source"}</span>
        </>
      )}
    </>
  );
}

function BgEraserOptions() {
  const t = useToolStore();
  return (
    <>
      <BrushOptions showColor={false} />
      <div className="w-28">
        <LiveSlider label="Tolerance" min={1} max={100} value={t.bgEraserTolerance} onLive={(bgEraserTolerance) => t.set({ bgEraserTolerance })} testId="bg-tolerance" />
      </div>
    </>
  );
}

/** Context-sensitive options for the active tool. */
export function ToolOptionsBar() {
  const tool = useEditorStore((s) => s.tool);
  const gradientKind = useToolStore((s) => s.gradientKind);
  const set = useToolStore((s) => s.set);
  let content: React.ReactNode = null;
  if (tool === "brush" || tool === "pencil") content = <BrushOptions showColor />;
  else if (tool === "select-brush") content = <BrushOptions showColor={false} />;
  else if (tool === "eraser") content = <BrushOptions showColor={false} />;
  else if (tool === "bg-eraser") content = <BgEraserOptions />;
  else if (RETOUCH_TOOL_IDS.includes(tool)) content = <RetouchOptions tool={tool} />;
  else if (tool === "gradient")
    content = (
      <div className="flex items-center gap-1 text-xs">
        Gradient:
        {(["linear", "radial"] as const).map((k) => (
          <Button key={k} size="xs" variant={gradientKind === k ? "secondary" : "ghost"} aria-pressed={gradientKind === k} onClick={() => set({ gradientKind: k })}>
            {k === "linear" ? "Linear" : "Radial"}
          </Button>
        ))}
        <span className="text-muted-foreground">Drag on the image. White (start) reveals, transparent (end) hides.</span>
      </div>
    );
  else if (["select-rect", "select-ellipse", "lasso", "polygon", "wand"].includes(tool)) content = <SelectionOptions wand={tool === "wand"} />;
  if (!content) return null;
  return (
    <div className="flex items-end gap-3 overflow-x-auto border-b border-border bg-card px-3 py-1" role="region" aria-label="Tool options" data-testid="tool-options">
      {content}
    </div>
  );
}
