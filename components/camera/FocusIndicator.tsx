"use client";

export type FocusState = "pending" | "confirmed" | "unconfirmed";

/** Tap-to-focus ring at a position in the preview box (0..1 display coordinates). */
export function FocusIndicator({ point, state }: { point: { x: number; y: number } | null; state: FocusState }) {
  if (!point) return null;
  const color =
    state === "confirmed" ? "border-emerald-300" : state === "unconfirmed" ? "border-amber-300" : "border-white";
  return (
    <div
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
      role="status"
      aria-live="polite"
    >
      <div className={`size-16 rounded-full border-2 ${color} ${state === "pending" ? "animate-pulse" : ""}`} />
      <span className="absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-white">
        {state === "pending" ? "Focusing…" : state === "confirmed" ? "Focus point set" : "Focus point not confirmed"}
      </span>
    </div>
  );
}
