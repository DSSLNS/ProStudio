"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { AdjustmentSlider, Section } from "./controls/AdjustmentSlider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEditorStore } from "@/store/editorStore";
import { defaultRecipe, HSL_BANDS, type EditRecipe, type HslAdjust } from "@/types/edit";
import { LutSection } from "./LutSection";
import { PresetsSection } from "./PresetsSection";

const BAND_COLORS: Record<(typeof HSL_BANDS)[number], string> = {
  red: "#e5484d",
  orange: "#f2913d",
  yellow: "#f5d90a",
  green: "#46a758",
  aqua: "#12a594",
  blue: "#3e63dd",
  purple: "#8e4ec6",
  magenta: "#d6409f",
};
const HUE_TRACK = "linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)";

function HslMixer() {
  const [mode, setMode] = useState<keyof HslAdjust>("hue");
  return (
    <>
      <Tabs value={mode} onValueChange={(v) => setMode(v as keyof HslAdjust)} className="mb-2">
        <TabsList className="w-full">
          <TabsTrigger value="hue">Hue</TabsTrigger>
          <TabsTrigger value="saturation">Saturation</TabsTrigger>
          <TabsTrigger value="luminance">Luminance</TabsTrigger>
        </TabsList>
      </Tabs>
      {HSL_BANDS.map((band) => (
        <AdjustmentSlider
          key={`${band}-${mode}`}
          label={band[0].toUpperCase() + band.slice(1)}
          historyLabel={`HSL ${band} ${mode}`}
          min={-100}
          max={100}
          track={`linear-gradient(90deg, #444, ${BAND_COLORS[band]})`}
          get={(r) => r.hsl[band][mode]}
          set={(r, v) => {
            r.hsl[band][mode] = v;
          }}
        />
      ))}
    </>
  );
}

type WheelKey = "shadows" | "midtones" | "highlights" | "global";
function GradeWheelControls({ wheel, label }: { wheel: WheelKey; label: string }) {
  return (
    <div className="mb-2 rounded-md border border-border/60 p-2">
      <p className="mb-1 text-xs font-medium">{label}</p>
      <AdjustmentSlider
        label="Hue"
        historyLabel={`Grade ${wheel} hue`}
        min={0}
        max={360}
        format={(v) => `${Math.round(v)}°`}
        track={HUE_TRACK}
        get={(r) => r.grading[wheel].hue}
        set={(r, v) => {
          r.grading[wheel].hue = v;
        }}
      />
      <AdjustmentSlider
        label="Saturation"
        historyLabel={`Grade ${wheel} saturation`}
        min={0}
        max={100}
        format={(v) => `${v}`}
        get={(r) => r.grading[wheel].saturation}
        set={(r, v) => {
          r.grading[wheel].saturation = v;
        }}
      />
      <AdjustmentSlider
        label="Luminance"
        historyLabel={`Grade ${wheel} luminance`}
        min={-100}
        max={100}
        get={(r) => r.grading[wheel].luminance}
        set={(r, v) => {
          r.grading[wheel].luminance = v;
        }}
      />
    </div>
  );
}

const BALANCE_AXES: { label: string; track: string }[] = [
  { label: "Cyan ↔ Red", track: "linear-gradient(90deg,#0cc,#888,#d33)" },
  { label: "Magenta ↔ Green", track: "linear-gradient(90deg,#c3c,#888,#3b3)" },
  { label: "Yellow ↔ Blue", track: "linear-gradient(90deg,#dd3,#888,#36d)" },
];

function ColorBalance() {
  const [range, setRange] = useState<keyof EditRecipe["colorBalance"]>("midtones");
  return (
    <>
      <Tabs value={range} onValueChange={(v) => setRange(v as keyof EditRecipe["colorBalance"])} className="mb-2">
        <TabsList className="w-full">
          <TabsTrigger value="shadows">Shadows</TabsTrigger>
          <TabsTrigger value="midtones">Midtones</TabsTrigger>
          <TabsTrigger value="highlights">Highlights</TabsTrigger>
        </TabsList>
      </Tabs>
      {BALANCE_AXES.map((axis, i) => (
        <AdjustmentSlider
          key={`${range}-${i}`}
          label={axis.label}
          historyLabel={`Color balance ${range}`}
          min={-100}
          max={100}
          track={axis.track}
          get={(r) => r.colorBalance[range][i]}
          set={(r, v) => {
            r.colorBalance[range][i] = v;
          }}
        />
      ))}
    </>
  );
}

export function ColorPanel() {
  const applyRecipe = useEditorStore((s) => s.applyRecipe);
  const resetBtn = (label: string, fn: (r: EditRecipe) => void) => (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`Reset ${label}`}
      title={`Reset ${label}`}
      onClick={() => applyRecipe(`Reset ${label}`, fn)}
    >
      <RotateCcw />
    </Button>
  );
  return (
    <div>
      <Section
        title="White balance"
        actions={resetBtn("white balance", (r) => {
          r.color.temperature = 0;
          r.color.tint = 0;
        })}
      >
        <AdjustmentSlider
          label="Temperature"
          min={-100}
          max={100}
          track="linear-gradient(90deg,#3a7bd5,#9a9a9a,#e8a33d)"
          get={(r) => r.color.temperature}
          set={(r, v) => {
            r.color.temperature = v;
          }}
        />
        <AdjustmentSlider
          label="Tint"
          min={-100}
          max={100}
          track="linear-gradient(90deg,#3fae4a,#9a9a9a,#c13fc1)"
          get={(r) => r.color.tint}
          set={(r, v) => {
            r.color.tint = v;
          }}
        />
      </Section>
      <Section
        title="Presence"
        actions={resetBtn("presence", (r) => {
          r.color.vibrance = 0;
          r.color.saturation = 0;
          r.color.hue = 0;
        })}
      >
        <AdjustmentSlider
          label="Vibrance"
          min={-100}
          max={100}
          get={(r) => r.color.vibrance}
          set={(r, v) => void (r.color.vibrance = v)}
        />
        <AdjustmentSlider
          label="Saturation"
          min={-100}
          max={100}
          get={(r) => r.color.saturation}
          set={(r, v) => void (r.color.saturation = v)}
        />
        <AdjustmentSlider
          label="Hue"
          min={-180}
          max={180}
          format={(v) => `${v > 0 ? "+" : ""}${Math.round(v)}°`}
          track={HUE_TRACK}
          get={(r) => r.color.hue}
          set={(r, v) => void (r.color.hue = v)}
        />
      </Section>
      <Section title="Color mixer (HSL)" actions={resetBtn("HSL", (r) => void (r.hsl = defaultRecipe().hsl))}>
        <HslMixer />
      </Section>
      <Section
        title="Color grading"
        actions={resetBtn("color grading", (r) => void (r.grading = defaultRecipe().grading))}
      >
        <p className="mb-2 text-xs text-muted-foreground">Split toning: use the Shadows and Highlights ranges only.</p>
        <GradeWheelControls wheel="shadows" label="Shadows" />
        <GradeWheelControls wheel="midtones" label="Midtones" />
        <GradeWheelControls wheel="highlights" label="Highlights" />
        <GradeWheelControls wheel="global" label="Global" />
        <AdjustmentSlider
          label="Blending"
          min={0}
          max={100}
          defaultValue={50}
          format={(v) => `${v}`}
          get={(r) => r.grading.blending}
          set={(r, v) => void (r.grading.blending = v)}
        />
        <AdjustmentSlider
          label="Balance"
          min={-100}
          max={100}
          get={(r) => r.grading.balance}
          set={(r, v) => void (r.grading.balance = v)}
        />
      </Section>
      <Section
        title="Color balance"
        actions={resetBtn("color balance", (r) => void (r.colorBalance = defaultRecipe().colorBalance))}
      >
        <ColorBalance />
      </Section>
      <LutSection />
      <PresetsSection />
    </div>
  );
}
