"use client";

import { useId, useState } from "react";

/**
 * Accessible range input. `onChange` fires while dragging (for display);
 * `onCommit` fires on release / keyboard change so the camera isn't flooded
 * with applyConstraints calls.
 */
export function RangeControl({
  label,
  value,
  min,
  max,
  step,
  format,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onCommit: (v: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState<number | null>(null);
  const local = draft ?? value;
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-white/70">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="font-medium text-white tabular-nums">
          {format(local)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step || "any"}
        value={local}
        disabled={disabled}
        aria-valuetext={format(local)}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="h-6 w-full accent-[var(--brand)] disabled:opacity-40"
      />
    </div>
  );
}
