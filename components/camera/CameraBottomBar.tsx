"use client";

import Link from "next/link";
import { Images, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CameraMode } from "@/store/cameraStore";
import { CaptureButton } from "./CaptureButton";
import { ZoomControl } from "./ZoomControl";

function ModeLink({ mode, current }: { mode: CameraMode; current: CameraMode }) {
  const active = mode === current;
  return (
    <Link
      href={`/camera/${mode}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-semibold tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-brand",
        active ? "bg-white/15 text-brand underline underline-offset-4" : "text-white/70 hover:text-white",
      )}
    >
      {mode.toUpperCase()}
    </Link>
  );
}

/** Bottom: zoom, gallery, shutter, panel toggle, AUTO | MANUAL selector. */
export function CameraBottomBar({
  mode,
  panelLabel,
  panelOpen,
  onTogglePanel,
}: {
  mode: CameraMode;
  panelLabel: string;
  panelOpen: boolean;
  onTogglePanel: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
      <ZoomControl />
      <div className="grid w-full max-w-md grid-cols-3 items-center">
        <Link
          href="/projects"
          aria-label="Gallery (projects)"
          className="flex size-12 items-center justify-center justify-self-start rounded-full bg-white/10 text-white outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Images className="size-5" />
        </Link>
        <div className="justify-self-center">
          <CaptureButton />
        </div>
        <button
          type="button"
          onClick={onTogglePanel}
          aria-expanded={panelOpen}
          aria-controls="camera-panel"
          className="flex min-h-12 flex-col items-center justify-center justify-self-end rounded-full px-3 text-[10px] text-white outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-brand"
        >
          <SlidersHorizontal className="size-5" aria-hidden />
          {panelLabel}
        </button>
      </div>
      <nav aria-label="Camera mode" className="flex items-center gap-1">
        <ModeLink mode="auto" current={mode} />
        <span className="text-white/30" aria-hidden>
          |
        </span>
        <ModeLink mode="manual" current={mode} />
      </nav>
    </div>
  );
}
