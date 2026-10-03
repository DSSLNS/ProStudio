"use client";

import { useId } from "react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

/**
 * Generic labelled slider: `onLive` while dragging (no history), `onCommit` on
 * release. Used for layer properties and tool options.
 */
export function LiveSlider({
  label,
  value,
  min,
  max,
  step = 1,
  format = (v) => `${Math.round(v * 100) / 100}`,
  onLive,
  onCommit,
  disabled,
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onLive: (v: number) => void;
  onCommit?: (v: number) => void;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className={cn("grid gap-1.5 py-1", disabled && "opacity-50")} data-testid={testId}>
      <div className="flex justify-between text-xs">
        <label htmlFor={id} className="text-muted-foreground">
          {label}
        </label>
        <span className="font-mono tabular-nums">{format(value)}</span>
      </div>
      <Slider
        id={id}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        largeStep={step * 10}
        value={value}
        disabled={disabled}
        onValueChange={(v) => onLive(Array.isArray(v) ? v[0] : (v as number))}
        onValueCommitted={(v) => onCommit?.(Array.isArray(v) ? v[0] : (v as number))}
      />
    </div>
  );
}
