"use client";

import {
  Brush,
  Crop,
  Eraser,
  Hand,
  Lasso,
  MousePointer2,
  Pencil,
  SquareDashed,
  CircleDashed,
  SquareDashedMousePointer,
  Wand,
  Pentagon,
  ZoomIn,
  Stamp,
  Bandage,
  Sparkles,
  Eye,
  Sun,
  Moon,
  Pointer,
  Droplet,
  Triangle,
  ScanLine,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { RETOUCH_TOOL_IDS, useEditorStore, type EditorTool } from "@/store/editorStore";
import { useViewState } from "./viewState";

export const TOOLS: { id: EditorTool; label: string; key: string; icon: LucideIcon; help: string }[] = [
  { id: "move", label: "Move", key: "M", icon: MousePointer2, help: "Drag the active text/shape/image layer; drag corners to resize." },
  { id: "hand", label: "Hand (pan)", key: "H", icon: Hand, help: "Drag to pan. Hold Space with any tool." },
  { id: "zoom", label: "Zoom (Alt-click to zoom out)", key: "Z", icon: ZoomIn, help: "Click to zoom in, Alt-click to zoom out." },
  { id: "crop", label: "Crop", key: "C", icon: Crop, help: "Drag handles; Enter applies." },
  { id: "select-rect", label: "Rectangle select", key: "R", icon: SquareDashed, help: "Drag to select. Shift adds, Alt subtracts, Shift+Alt intersects." },
  { id: "select-ellipse", label: "Ellipse select", key: "O", icon: CircleDashed, help: "Drag to select an ellipse. Shift/Alt modify." },
  { id: "lasso", label: "Lasso", key: "L", icon: Lasso, help: "Drag a freehand outline." },
  { id: "polygon", label: "Polygonal lasso", key: "P", icon: Pentagon, help: "Click points; double-click, Enter or click the start to close. Esc cancels." },
  { id: "select-brush", label: "Selection brush", key: "Q", icon: Brush, help: "Paint to add to the selection (Alt paints to subtract). Use it to mark objects for AI removal." },
  { id: "wand", label: "Magic wand", key: "W", icon: Wand, help: "Click to select similar colours (tolerance in tool options)." },
  { id: "brush", label: "Brush", key: "B", icon: Brush, help: "Paints on a paint layer, or reveals/hides when editing a mask." },
  { id: "pencil", label: "Pencil", key: "N", icon: Pencil, help: "Hard-edged, aliased brush." },
  { id: "eraser", label: "Eraser", key: "E", icon: Eraser, help: "Erases paint, or hides pixels through the layer mask (non-destructive)." },
  { id: "bg-eraser", label: "Background eraser", key: "Shift+E", icon: Eraser, help: "Hides pixels similar to the colour under the brush when you start the stroke (via the layer mask)." },
  { id: "clone", label: "Clone stamp", key: "S", icon: Stamp, help: "Alt-click to set the source, then paint to copy it." },
  { id: "heal", label: "Healing brush", key: "J", icon: Bandage, help: "Like clone, but blends texture into the destination's tone and colour. Alt-click sets the source." },
  { id: "spot-heal", label: "Spot healing / blemish", key: "Shift+J", icon: Sparkles, help: "Click or paint over a spot; the source is chosen automatically." },
  { id: "redeye", label: "Red-eye removal", key: "Shift+R", icon: Eye, help: "Click each eye (brush size ≈ pupil size)." },
  { id: "dodge", label: "Dodge", key: "D", icon: Sun, help: "Lighten locally (shadows/midtones/highlights)." },
  { id: "burn", label: "Burn", key: "Shift+D", icon: Moon, help: "Darken locally." },
  { id: "smudge", label: "Smudge", key: "U", icon: Pointer, help: "Push colour along the stroke." },
  { id: "blur-brush", label: "Blur brush", key: "", icon: Droplet, help: "Soften detail where you paint." },
  { id: "sharpen-brush", label: "Sharpen brush", key: "", icon: Triangle, help: "Sharpen detail where you paint." },
  { id: "dust", label: "Dust & scratches", key: "", icon: ScanLine, help: "Removes small specks that differ from their surroundings by more than the threshold." },
  { id: "gradient", label: "Gradient mask", key: "G", icon: SquareDashedMousePointer, help: "Drag to draw a gradient on the active layer's mask." },
];

/** Left toolbox. Lists only tools that are implemented in this build. */
export function EditorToolbar({ horizontal = false }: { horizontal?: boolean }) {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const cpu = useViewState((v) => v.renderInfo?.backend === "cpu");
  return (
    <div
      role="toolbar"
      aria-label="Tools"
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      className={horizontal ? "flex gap-1 overflow-x-auto p-1" : "flex h-full flex-col gap-0.5 overflow-y-auto p-1.5"}
    >
      {TOOLS.map((t) => (
        <Tooltip key={t.id}>
          <TooltipTrigger
            render={
              <Button
                variant={tool === t.id ? "secondary" : "ghost"}
                size="icon"
                aria-label={t.key ? `${t.label} (${t.key})` : t.label}
                aria-pressed={tool === t.id}
                onClick={() => setTool(t.id)}
                disabled={cpu && RETOUCH_TOOL_IDS.includes(t.id)}
                data-testid={`tool-${t.id}`}
              />
            }
          >
            <t.icon />
          </TooltipTrigger>
          <TooltipContent side={horizontal ? "bottom" : "right"} className="max-w-56">
            <span className="font-medium">{t.label}</span> {t.key && <kbd className="ml-1 font-mono text-[10px] opacity-70">{t.key}</kbd>}
            <span className="mt-0.5 block text-[11px] opacity-80">
              {cpu && RETOUCH_TOOL_IDS.includes(t.id) ? "Requires GPU rendering (WebGL2), which is off or unavailable." : t.help}
            </span>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
