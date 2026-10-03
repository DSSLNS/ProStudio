"use client";

import { memo, useId, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { useEditorStore } from "@/store/editorStore";
import type { EditRecipe } from "@/types/edit";
import { cn } from "@/lib/utils";

export interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  /** Format the numeric readout. */
  format?: (v: number) => string;
  /** Optional CSS gradient for the track (e.g. temperature). */
  track?: string;
}

interface Props extends SliderSpec {
  get: (r: EditRecipe) => number;
  set: (r: EditRecipe, v: number) => void;
  /** History label; defaults to the slider label. */
  historyLabel?: string;
  disabled?: boolean;
}

const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);

/**
 * A recipe-bound slider: live updates while dragging (no history spam), one
 * history entry on release. Double-click the label (or press 0/Delete on the
 * value) to reset. The numeric value is editable for precise entry.
 */
export const AdjustmentSlider = memo(function AdjustmentSlider({
  label,
  min,
  max,
  step = 1,
  defaultValue = 0,
  format = signed,
  track,
  get,
  set,
  historyLabel,
  disabled,
}: Props) {
  const value = useEditorStore((s) => get(s.recipe));
  const updateRecipe = useEditorStore((s) => s.updateRecipe);
  const commit = useEditorStore((s) => s.commit);
  const [editing, setEditing] = useState<string | null>(null);
  const id = useId();

  const setValue = (v: number, doCommit: boolean) => {
    const clamped = Math.max(min, Math.min(max, v));
    updateRecipe((r) => set(r, clamped));
    if (doCommit) commit(historyLabel ?? label);
  };

  const reset = () => setValue(defaultValue, true);
  const changed = Math.abs(value - defaultValue) > 1e-9;

  return (
    <div className={cn("grid gap-1.5 py-1", disabled && "opacity-50")}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <label
          htmlFor={id}
          className={cn("cursor-default select-none", changed ? "text-foreground" : "text-muted-foreground")}
          onDoubleClick={reset}
          title="Double-click to reset"
        >
          {label}
        </label>
        <input
          aria-label={`${label} value`}
          className="w-14 rounded bg-transparent px-1 text-right font-mono text-xs tabular-nums outline-none hover:bg-muted focus:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
          value={editing ?? format(Math.round(value / step) * step)}
          onChange={(e) => setEditing(e.target.value)}
          onFocus={(e) => {
            setEditing(String(Math.round(value / step) * step));
            e.target.select();
          }}
          onBlur={() => {
            if (editing !== null) {
              const n = parseFloat(editing.replace(/[^\d.+-]/g, ""));
              if (Number.isFinite(n)) setValue(n, true);
            }
            setEditing(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setEditing(null);
              (e.target as HTMLInputElement).blur();
            }
          }}
          disabled={disabled}
        />
      </div>
      <div className="relative">
        {track && (
          <div
            className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full opacity-70"
            style={{ background: track }}
          />
        )}
        <Slider
          id={id}
          aria-label={label}
          min={min}
          max={max}
          step={step}
          largeStep={step * 10}
          value={value}
          disabled={disabled}
          className={cn(
            track && "[&_[data-slot=slider-range]]:bg-transparent [&_[data-slot=slider-track]]:bg-transparent",
          )}
          onValueChange={(v) => setValue(Array.isArray(v) ? v[0] : (v as number), false)}
          onValueCommitted={() => commit(historyLabel ?? label)}
          onDoubleClick={reset}
        />
      </div>
    </div>
  );
});

export function Section({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="border-b border-border px-4 py-3" aria-label={title}>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}
