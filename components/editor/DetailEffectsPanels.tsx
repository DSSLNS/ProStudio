"use client";

import { AdjustmentSlider, Section } from "./controls/AdjustmentSlider";
import { useEditorStore } from "@/store/editorStore";

function PreviewScaleNote() {
  const scale = useEditorStore((s) => s.preview?.scale ?? 1);
  if (scale >= 0.999) return null;
  return (
    <p className="mb-2 text-xs text-muted-foreground">
      The preview is {Math.round(scale * 100)}% of full size, so fine sharpening and noise reduction are best judged
      after export or in Quality mode. Export always renders at full resolution.
    </p>
  );
}

export function DetailPanel() {
  return (
    <div>
      <Section title="Sharpening">
        <PreviewScaleNote />
        <AdjustmentSlider
          label="Amount"
          historyLabel="Sharpen amount"
          min={0}
          max={150}
          format={(v) => `${v}`}
          get={(r) => r.detail.sharpenAmount}
          set={(r, v) => void (r.detail.sharpenAmount = v)}
        />
        <AdjustmentSlider
          label="Radius"
          historyLabel="Sharpen radius"
          min={0.5}
          max={3}
          step={0.1}
          defaultValue={1}
          format={(v) => `${v.toFixed(1)} px`}
          get={(r) => r.detail.sharpenRadius}
          set={(r, v) => void (r.detail.sharpenRadius = v)}
        />
      </Section>
      <Section title="Noise reduction">
        <AdjustmentSlider
          label="Luminance"
          historyLabel="Luminance noise reduction"
          min={0}
          max={100}
          format={(v) => `${v}`}
          get={(r) => r.detail.noiseLuminance}
          set={(r, v) => void (r.detail.noiseLuminance = v)}
        />
        <AdjustmentSlider
          label="Color"
          historyLabel="Color noise reduction"
          min={0}
          max={100}
          format={(v) => `${v}`}
          get={(r) => r.detail.noiseColor}
          set={(r, v) => void (r.detail.noiseColor = v)}
        />
      </Section>
    </div>
  );
}

export function EffectsPanel() {
  return (
    <div>
      <Section title="Post-crop vignette">
        <AdjustmentSlider
          label="Amount"
          historyLabel="Vignette amount"
          min={-100}
          max={100}
          get={(r) => r.effects.vignetteAmount}
          set={(r, v) => void (r.effects.vignetteAmount = v)}
        />
        <AdjustmentSlider
          label="Midpoint"
          historyLabel="Vignette midpoint"
          min={0}
          max={100}
          defaultValue={50}
          format={(v) => `${v}`}
          get={(r) => r.effects.vignetteMidpoint}
          set={(r, v) => void (r.effects.vignetteMidpoint = v)}
        />
        <AdjustmentSlider
          label="Feather"
          historyLabel="Vignette feather"
          min={0}
          max={100}
          defaultValue={50}
          format={(v) => `${v}`}
          get={(r) => r.effects.vignetteFeather}
          set={(r, v) => void (r.effects.vignetteFeather = v)}
        />
        <AdjustmentSlider
          label="Roundness"
          historyLabel="Vignette roundness"
          min={-100}
          max={100}
          get={(r) => r.effects.vignetteRoundness}
          set={(r, v) => void (r.effects.vignetteRoundness = v)}
        />
      </Section>
      <Section title="Grain">
        <AdjustmentSlider
          label="Amount"
          historyLabel="Grain"
          min={0}
          max={100}
          format={(v) => `${v}`}
          get={(r) => r.effects.grain}
          set={(r, v) => void (r.effects.grain = v)}
        />
      </Section>
    </div>
  );
}
