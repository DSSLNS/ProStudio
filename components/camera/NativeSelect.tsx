import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Native <select> styled for the dark camera UI (fully keyboard/screen-reader accessible). */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 rounded-md border border-white/20 bg-neutral-900 px-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-brand",
        className,
      )}
      {...props}
    />
  );
}
