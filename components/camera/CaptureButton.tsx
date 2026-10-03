"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useCameraStore } from "@/store/cameraStore";
import { useCameraApi } from "./CameraContext";

/** Large shutter button. Space/Enter (native button) or Space anywhere outside form fields captures. */
export function CaptureButton() {
  const api = useCameraApi();
  const status = useCameraStore((s) => s.status);
  const capturing = useCameraStore((s) => s.capturing);
  const countdown = useCameraStore((s) => s.countdown);
  const burst = useCameraStore((s) => s.burst);
  const kind = useCameraStore((s) => s.captureKind);
  const progress = useCameraStore((s) => s.captureProgress);
  const timer = useCameraStore((s) => s.timer);
  const disabled = status !== "live" || capturing;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && t !== document.body) return; // focused controls handle their own keys
      e.preventDefault();
      if (useCameraStore.getState().countdown !== null) api.cancelCountdown();
      else void api.capture();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [api]);

  const label =
    countdown !== null
      ? `Cancel self-timer (${countdown} s left)`
      : kind === "night"
        ? "Capture night photo (multi-frame)"
        : kind === "hdr"
          ? "Capture HDR photo (3 bracketed frames)"
          : burst > 1
            ? `Capture burst of ${burst} photos`
            : timer > 0
              ? `Take photo with ${timer} second timer`
              : "Take photo";

  return (
    <button
      type="button"
      data-testid="capture-button"
      aria-label={label}
      aria-busy={capturing}
      disabled={disabled && countdown === null}
      onClick={() => (countdown !== null ? api.cancelCountdown() : void api.capture())}
      className={cn(
        "relative flex size-20 items-center justify-center rounded-full border-4 border-white bg-transparent outline-none transition-transform",
        "focus-visible:ring-4 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-black active:scale-95 disabled:opacity-50",
      )}
    >
      <span
        className={cn(
          "flex size-16 items-center justify-center rounded-full text-lg font-semibold text-black transition-colors",
          kind === "night" ? "bg-indigo-300" : kind === "hdr" ? "bg-amber-200" : "bg-white",
          capturing && "animate-pulse",
        )}
      >
        {countdown !== null
          ? countdown
          : capturing && progress !== null
            ? `${Math.round(progress * 100)}%`
            : burst > 1 && kind === "single"
              ? `×${burst}`
              : ""}
      </span>
    </button>
  );
}
