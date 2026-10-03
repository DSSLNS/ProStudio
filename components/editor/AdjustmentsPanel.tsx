"use client";

import { RotateCcw, Sparkles } from "lucide-react";
import { AdjustmentSlider, Section } from "./controls/AdjustmentSlider";
import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/store/editorStore";
import { defaultRecipe, type EditRecipe } from "@/types/edit";
import { AutoEditDialog } from "./AutoEditDialog";
import { useState } from "react";

type LightKey = keyof EditRecipe["light"];
const LIGHT: {
  key: LightKey;
  label: string;
  min: number;
  max: number;
  step?: number;
  def?: number;
  fmt?: (v: number) => string;
}[] = [
  {
    key: "exposure",
    label: "Exposure",
    min: -5,
    max: 5,
    step: 0.01,
    fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} EV`,
  },
  { key: "contrast", label: "Contrast", min: -100, max: 100 },
  { key: "highlights", label: "Highlights", min: -100, max: 100 },
  { key: "shadows", label: "Shadows", min: -100, max: 100 },
  { key: "whites", label: "Whites", min: -100, max: 100 },
  { key: "blacks", label: "Blacks", min: -100, max: 100 },
  { key: "brightness", label: "Brightness", min: -100, max: 100 },
  { key: "gamma", label: "Gamma", min: 0.2, max: 3, step: 0.01, def: 1, fmt: (v) => v.toFixed(2) },
];
const PRESENCE: typeof LIGHT = [
  { key: "clarity", label: "Clarity", min: -100, max: 100 },
  { key: "texture", label: "Texture", min: -100, max: 100 },
  { key: "dehaze", label: "Dehaze", min: -100, max: 100 },
];

function LightSliders({ items }: { items: typeof LIGHT }) {
  return (
    <>
      {items.map((s) => (
        <AdjustmentSlider
          key={s.key}
          label={s.label}
          min={s.min}
          max={s.max}
          step={s.step}
          defaultValue={s.def ?? 0}
          format={s.fmt}
          get={(r) => r.light[s.key]}
          set={(r, v) => {
            r.light[s.key] = v;
          }}
        />
      ))}
    </>
  );
}

export function AdjustmentsPanel() {
  const applyRecipe = useEditorStore((s) => s.applyRecipe);
  const [autoOpen, setAutoOpen] = useState(false);
  return (
    <div>
      <div className="flex gap-2 border-b border-border p-3">
        <Button className="flex-1" onClick={() => setAutoOpen(true)} data-testid="auto-edit">
          <Sparkles aria-hidden /> Auto Edit
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Reset light adjustments"
          title="Reset light"
          onClick={() =>
            applyRecipe("Reset light", (r) => {
              r.light = defaultRecipe().light;
            })
          }
        >
          <RotateCcw />
        </Button>
      </div>
      <Section title="Light">
        <LightSliders items={LIGHT} />
      </Section>
      <Section title="Presence">
        <LightSliders items={PRESENCE} />
      </Section>
      <AutoEditDialog open={autoOpen} onOpenChange={setAutoOpen} />
    </div>
  );
}
