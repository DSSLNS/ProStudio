import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Icon button for the dark camera chrome; `active` is announced via aria-pressed, not colour alone. */
export function ToolbarButton({
  active,
  className,
  children,
  ...props
}: ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-10 min-w-10 items-center justify-center gap-1 rounded-full px-2 text-xs font-medium text-white outline-none",
        "hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40",
        active && "bg-white/20 text-brand",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
