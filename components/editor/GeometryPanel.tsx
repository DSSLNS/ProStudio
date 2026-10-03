"use client";

import { Crop, FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw, Undo2 } from "lucide-react";
import { AdjustmentSlider, Section } from "./controls/AdjustmentSlider";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useEditorStore } from "@/store/editorStore";
import { useViewState } from "./viewState";
import { constrainCrop, cropForAspect } from "./CropTool";
import { maxInscribedCrop, orientedSize } from "@/engine/image/transform";
import { defaultRecipe } from "@/types/edit";
import { useState } from "react";

const ASPECTS: { label: string; value: number | null | "original" }[] = [
  { label: "Free", value: null },
  { label: "Original", value: "original" },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "16:9", value: 16 / 9 },
  { label: "9:16", value: 9 / 16 },
  { label: "5:4", value: 5 / 4 },
];

export function GeometryPanel() {
  const project = useEditorStore((s) => s.project);
  const geometry = useEditorStore((s) => s.recipe.geometry);
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const applyRecipe = useEditorStore((s) => s.applyRecipe);
  const cropAspect = useViewState((s) => s.cropAspect);
  const [constrain, setConstrain] = useState(true);
  if (!project) return null;
  const frame = orientedSize(project.width, project.height, geometry);

  const chooseAspect = (v: number | null | "original") => {
    const aspect = v === "original" ? frame.width / frame.height : v;
    useViewState.getState().set({ cropAspect: aspect });
    if (tool !== "crop") setTool("crop");
    const cur = useViewState.getState().draftCrop ?? geometry.crop;
    const next = aspect ? (cur ? constrainCrop(cur, aspect, frame) : cropForAspect(aspect, frame)) : cur;
    useViewState.getState().set({ draftCrop: next ?? cropForAspect(aspect, frame) });
  };

  return (
    <div>
      <Section title="Crop">
        <Button
          className="mb-3 w-full"
          variant={tool === "crop" ? "default" : "outline"}
          onClick={() => setTool(tool === "crop" ? "move" : "crop")}
          data-testid="crop-tool"
        >
          <Crop aria-hidden /> {tool === "crop" ? "Cropping… (Enter to apply)" : "Crop (C)"}
        </Button>
        <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Crop aspect ratio">
          {ASPECTS.map((a) => {
            const val = a.value === "original" ? frame.width / frame.height : a.value;
            const selected =
              cropAspect === val || (cropAspect !== null && val !== null && Math.abs(cropAspect - val) < 1e-6);
            return (
              <Button
                key={a.label}
                size="xs"
                variant={selected ? "secondary" : "ghost"}
                role="radio"
                aria-checked={selected}
                onClick={() => chooseAspect(a.value)}
              >
                {a.label}
              </Button>
            );
          })}
        </div>
        {geometry.crop && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => applyRecipe("Clear crop", (r) => void (r.geometry.crop = null))}
          >
            <Undo2 aria-hidden /> Clear crop
          </Button>
        )}
      </Section>
      <Section title="Rotate & flip">
        <div className="grid grid-cols-4 gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Rotate 90° counter-clockwise"
            title="Rotate left"
            onClick={() =>
              applyRecipe(
                "Rotate left",
                (r) =>
                  void ((r.geometry.rotation = ((r.geometry.rotation + 270) % 360) as 0 | 90 | 180 | 270),
                  (r.geometry.crop = null)),
              )
            }
          >
            <RotateCcw />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Rotate 90° clockwise"
            title="Rotate right"
            data-testid="rotate-right"
            onClick={() =>
              applyRecipe(
                "Rotate right",
                (r) =>
                  void ((r.geometry.rotation = ((r.geometry.rotation + 90) % 360) as 0 | 90 | 180 | 270),
                  (r.geometry.crop = null)),
              )
            }
          >
            <RotateCw />
          </Button>
          <Button
            variant={geometry.flipH ? "secondary" : "outline"}
            size="icon"
            aria-label="Flip horizontal"
            aria-pressed={geometry.flipH}
            title="Flip horizontal"
            onClick={() => applyRecipe("Flip horizontal", (r) => void (r.geometry.flipH = !r.geometry.flipH))}
          >
            <FlipHorizontal2 />
          </Button>
          <Button
            variant={geometry.flipV ? "secondary" : "outline"}
            size="icon"
            aria-label="Flip vertical"
            aria-pressed={geometry.flipV}
            title="Flip vertical"
            onClick={() => applyRecipe("Flip vertical", (r) => void (r.geometry.flipV = !r.geometry.flipV))}
          >
            <FlipVertical2 />
          </Button>
        </div>
        <AdjustmentSlider
          label="Straighten"
          min={-45}
          max={45}
          step={0.1}
          format={(v) => `${v.toFixed(1)}°`}
          get={(r) => r.geometry.straighten}
          set={(r, v) => {
            r.geometry.straighten = v;
            if (constrain) {
              const f = orientedSize(project.width, project.height, r.geometry);
              r.geometry.crop = Math.abs(v) < 0.01 ? null : maxInscribedCrop(f.width, f.height, v);
            }
          }}
        />
        <div className="flex items-center gap-2 py-1">
          <Switch id="constrain-crop" checked={constrain} onCheckedChange={setConstrain} />
          <Label htmlFor="constrain-crop" className="text-xs">
            Constrain crop to image when straightening
          </Label>
        </div>
      </Section>
      <Section title="Transform">
        <AdjustmentSlider
          label="Vertical perspective"
          min={-100}
          max={100}
          get={(r) => r.geometry.perspectiveV}
          set={(r, v) => void (r.geometry.perspectiveV = v)}
        />
        <AdjustmentSlider
          label="Horizontal perspective"
          min={-100}
          max={100}
          get={(r) => r.geometry.perspectiveH}
          set={(r, v) => void (r.geometry.perspectiveH = v)}
        />
        <AdjustmentSlider
          label="Skew X"
          min={-100}
          max={100}
          get={(r) => r.geometry.skewX}
          set={(r, v) => void (r.geometry.skewX = v)}
        />
        <AdjustmentSlider
          label="Skew Y"
          min={-100}
          max={100}
          get={(r) => r.geometry.skewY}
          set={(r, v) => void (r.geometry.skewY = v)}
        />
        <AdjustmentSlider
          label="Scale"
          min={50}
          max={200}
          defaultValue={100}
          format={(v) => `${v}%`}
          get={(r) => r.geometry.scale}
          set={(r, v) => void (r.geometry.scale = v)}
        />
        <Button
          variant="ghost"
          size="sm"
          className="mt-1"
          onClick={() => applyRecipe("Reset geometry", (r) => void (r.geometry = defaultRecipe().geometry))}
        >
          <Undo2 aria-hidden /> Reset all geometry
        </Button>
      </Section>
    </div>
  );
}
