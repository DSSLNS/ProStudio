import type { ReactNode } from "react";
import { Ban, CheckCircle2, CircleDashed } from "lucide-react";
import { cn } from "@/lib/utils";

/** A labelled control section in the manual controls panel. */
export function ControlRow({
  label,
  status,
  children,
  className,
}: {
  label: string;
  status?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-2 py-3", className)} aria-label={label}>
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/80">{label}</h3>
        {status && <div className="ml-auto text-[11px] text-white/60">{status}</div>}
      </div>
      {children}
    </section>
  );
}

/** Honest "not available" line for a control the browser/device does not expose. */
export function Unavailable({ label, reason }: { label: string; reason?: string }) {
  return (
    <p className="flex items-start gap-2 text-sm text-white/60" data-testid="control-unavailable">
      <Ban className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {label} — {reason ?? "Not available on this device/browser"}
      </span>
    </p>
  );
}

/** Shows whether a value was confirmed by getSettings() after applying. */
export function ConfirmedBadge({ confirmed, text }: { confirmed: boolean; text: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", confirmed ? "text-emerald-300" : "text-amber-300")}>
      {confirmed ? (
        <CheckCircle2 className="size-3.5" aria-hidden />
      ) : (
        <CircleDashed className="size-3.5" aria-hidden />
      )}
      {text}
      <span className="sr-only">{confirmed ? "(confirmed by camera)" : "(not confirmed by camera)"}</span>
    </span>
  );
}

/** Small pill button group used for discrete choices (ISO stops, presets, …). */
export function Chips<T extends string | number>({
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-8 rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40",
              active
                ? "border-brand bg-brand text-brand-foreground"
                : "border-white/20 bg-white/5 text-white hover:bg-white/15",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
