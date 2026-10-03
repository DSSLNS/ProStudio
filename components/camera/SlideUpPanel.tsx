"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Non-modal panel that slides up over the bottom of the viewfinder so the
 * preview stays visible while adjusting settings. Escape closes it.
 */
export function SlideUpPanel({
  open,
  onClose,
  title,
  children,
  id,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  id: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      id={id}
      ref={ref}
      tabIndex={-1}
      role="region"
      aria-label={title}
      hidden={!open}
      className={cn(
        "absolute inset-x-0 bottom-0 z-30 max-h-[60dvh] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-neutral-950/92 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-white shadow-2xl outline-none backdrop-blur",
        "sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[26rem] sm:rounded-2xl sm:border",
      )}
    >
      <div className="sticky top-0 z-10 -mx-4 flex items-center bg-neutral-950/95 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title}`}
          className="ml-auto rounded-full p-1.5 text-white/80 outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-brand"
        >
          <X className="size-4" />
        </button>
      </div>
      {children}
    </div>
  );
}
