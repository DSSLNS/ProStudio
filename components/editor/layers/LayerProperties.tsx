"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LiveSlider } from "../controls/LiveSlider";
import { useLayerActions } from "./useLayerActions";
import { measureText } from "@/engine/layers/raster";
import {
  defaultAdjustment,
  type AdjustmentParams,
  type LayerDoc,
  type Placement,
  type TextLayer,
} from "@/types/layers";

const ADJ: {
  key: keyof AdjustmentParams;
  label: string;
  min: number;
  max: number;
  step?: number;
  fmt?: (v: number) => string;
}[] = [
  {
    key: "exposure",
    label: "Exposure",
    min: -4,
    max: 4,
    step: 0.01,
    fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} EV`,
  },
  { key: "contrast", label: "Contrast", min: -100, max: 100 },
  { key: "highlights", label: "Highlights", min: -100, max: 100 },
  { key: "shadows", label: "Shadows", min: -100, max: 100 },
  { key: "saturation", label: "Saturation", min: -100, max: 100 },
  { key: "temperature", label: "Temperature", min: -100, max: 100 },
  { key: "tint", label: "Tint", min: -100, max: 100 },
  { key: "hue", label: "Hue", min: -180, max: 180, fmt: (v) => `${Math.round(v)}°` },
];

function NumberField({
  label,
  value,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="number"
        className="h-7 px-1.5 text-xs"
        defaultValue={Math.round(value * 10) / 10}
        key={value}
        disabled={disabled}
        onBlur={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n) && n !== value) onCommit(n);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

function PlacementFields({ layer }: { layer: Extract<LayerDoc, { placement: Placement }> }) {
  const a = useLayerActions();
  const p = layer.placement;
  const set = (patch: Partial<Placement>) =>
    a.patch(layer.id, { placement: { ...p, ...patch } } as Partial<LayerDoc>, "Transform layer");
  return (
    <div className="grid grid-cols-5 gap-1.5">
      <NumberField label="X" value={p.x} onCommit={(x) => set({ x })} disabled={layer.locked} />
      <NumberField label="Y" value={p.y} onCommit={(y) => set({ y })} disabled={layer.locked} />
      <NumberField
        label="W"
        value={p.width}
        onCommit={(width) => set({ width: Math.max(1, width) })}
        disabled={layer.locked}
      />
      <NumberField
        label="H"
        value={p.height}
        onCommit={(height) => set({ height: Math.max(1, height) })}
        disabled={layer.locked}
      />
      <NumberField label="Rot°" value={p.rotation} onCommit={(rotation) => set({ rotation })} disabled={layer.locked} />
    </div>
  );
}

function TextFields({ layer }: { layer: TextLayer }) {
  const a = useLayerActions();
  const update = (patch: Partial<TextLayer>, label: string) => {
    const next = { ...layer, ...patch };
    const m = measureText(next);
    a.patch(
      layer.id,
      { ...patch, placement: { ...layer.placement, width: m.width, height: m.height } } as Partial<LayerDoc>,
      label,
    );
  };
  return (
    <div className="grid gap-2">
      <Label htmlFor="text-content" className="text-xs">
        Text
      </Label>
      <textarea
        id="text-content"
        className="min-h-16 rounded-md border border-input bg-transparent p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        defaultValue={layer.text}
        key={layer.id}
        disabled={layer.locked}
        onBlur={(e) => e.target.value !== layer.text && update({ text: e.target.value.slice(0, 10_000) }, "Edit text")}
        data-testid="text-content"
      />
      <div className="grid grid-cols-3 gap-1.5">
        <NumberField
          label="Size (px)"
          value={layer.fontSize}
          onCommit={(fontSize) => update({ fontSize: Math.max(1, fontSize) }, "Font size")}
          disabled={layer.locked}
        />
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Colour</span>
          <input
            type="color"
            className="h-7 w-full rounded border border-input bg-transparent"
            value={layer.color}
            disabled={layer.locked}
            onChange={(e) => update({ color: e.target.value }, "Text colour")}
          />
        </label>
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Weight</span>
          <select
            className="h-7 rounded border border-input bg-transparent text-xs"
            value={layer.fontWeight}
            disabled={layer.locked}
            onChange={(e) => update({ fontWeight: parseInt(e.target.value, 10) }, "Font weight")}
          >
            {[300, 400, 600, 800].map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Font</span>
          <select
            className="h-7 rounded border border-input bg-transparent text-xs"
            value={layer.fontFamily}
            disabled={layer.locked}
            onChange={(e) => update({ fontFamily: e.target.value }, "Font")}
          >
            {[
              "system-ui, sans-serif",
              "Georgia, serif",
              "ui-monospace, monospace",
              "Impact, sans-serif",
              "cursive",
            ].map((f) => (
              <option key={f} value={f}>
                {f.split(",")[0]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">Align</span>
          <select
            className="h-7 rounded border border-input bg-transparent text-xs"
            value={layer.align}
            disabled={layer.locked}
            onChange={(e) => update({ align: e.target.value as TextLayer["align"] }, "Text align")}
          >
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
        </label>
      </div>
    </div>
  );
}

/** Kind-specific properties of the active layer. */
export function LayerProperties({ layer }: { layer: LayerDoc }) {
  const a = useLayerActions();
  if (layer.kind === "adjustment") {
    return (
      <div>
        {ADJ.map((s) => (
          <LiveSlider
            key={s.key}
            label={s.label}
            min={s.min}
            max={s.max}
            step={s.step}
            format={s.fmt ?? ((v) => `${v > 0 ? "+" : ""}${Math.round(v)}`)}
            value={layer.adjustment[s.key]}
            disabled={layer.locked}
            onLive={(v) =>
              a.patchLive(layer.id, { adjustment: { ...layer.adjustment, [s.key]: v } } as Partial<LayerDoc>)
            }
            onCommit={() => a.commitLive(`Adjustment ${s.label.toLowerCase()}`)}
          />
        ))}
        <Button
          variant="ghost"
          size="sm"
          disabled={layer.locked}
          onClick={() =>
            a.patch(layer.id, { adjustment: defaultAdjustment() } as Partial<LayerDoc>, "Reset adjustment")
          }
        >
          Reset adjustment
        </Button>
      </div>
    );
  }
  if (layer.kind === "text") {
    return (
      <div className="grid gap-3">
        <TextFields layer={layer} />
        <PlacementFields layer={layer} />
      </div>
    );
  }
  if (layer.kind === "shape") {
    return (
      <div className="grid gap-3">
        <div className="grid grid-cols-3 gap-1.5">
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Shape</span>
            <Select
              value={layer.shape}
              onValueChange={(v) => a.patch(layer.id, { shape: v } as Partial<LayerDoc>, "Change shape")}
              disabled={layer.locked}
            >
              <SelectTrigger className="h-7 text-xs" aria-label="Shape">
                <SelectValue>{layer.shape === "ellipse" ? "Ellipse" : "Rectangle"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rectangle">Rectangle</SelectItem>
                <SelectItem value="ellipse">Ellipse</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Fill</span>
            <input
              type="color"
              aria-label="Fill colour"
              className="h-7 w-full rounded border border-input"
              value={layer.fill ?? "#ffffff"}
              disabled={layer.locked}
              onChange={(e) => a.patch(layer.id, { fill: e.target.value } as Partial<LayerDoc>, "Shape fill")}
            />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="text-muted-foreground">Stroke</span>
            <input
              type="color"
              aria-label="Stroke colour"
              className="h-7 w-full rounded border border-input"
              value={layer.stroke ?? "#000000"}
              disabled={layer.locked}
              onChange={(e) =>
                a.patch(
                  layer.id,
                  { stroke: e.target.value, strokeWidth: layer.strokeWidth || 4 } as Partial<LayerDoc>,
                  "Shape stroke",
                )
              }
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField
            label="Stroke width"
            value={layer.strokeWidth}
            onCommit={(w) => a.patch(layer.id, { strokeWidth: Math.max(0, w) } as Partial<LayerDoc>, "Stroke width")}
            disabled={layer.locked}
          />
          <Button
            variant="outline"
            size="sm"
            className="self-end"
            disabled={layer.locked}
            onClick={() =>
              a.patch(layer.id, { fill: layer.fill ? null : "#ffffff" } as Partial<LayerDoc>, "Toggle fill")
            }
          >
            {layer.fill ? "Remove fill" : "Add fill"}
          </Button>
        </div>
        <PlacementFields layer={layer} />
      </div>
    );
  }
  if (layer.kind === "image") return <PlacementFields layer={layer} />;
  if (layer.kind === "paint") return <p className="text-xs text-muted-foreground">{layer.ops.length} brush strokes.</p>;
  if (layer.kind === "retouch")
    return (
      <p className="text-xs text-muted-foreground">
        {layer.ops.length} retouch strokes, re-applied to the image beneath.
      </p>
    );
  if (layer.kind === "group")
    return (
      <p className="text-xs text-muted-foreground">
        Group contents are composited together, then blended as one layer.
      </p>
    );
  return (
    <p className="text-xs text-muted-foreground">
      The developed photo. Its tone and colour come from the Light/Color/Curves panels.
    </p>
  );
}
