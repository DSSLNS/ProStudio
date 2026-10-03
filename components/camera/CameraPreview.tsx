"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { toast } from "sonner";
import { aspectCropRect } from "@/camera/capture";
import { tapToPoint } from "@/camera/focus";
import { useCameraStore } from "@/store/cameraStore";
import { useCameraApi } from "./CameraContext";
import { CameraGrid, CenterMarker } from "./CameraGrid";
import { FocusIndicator, type FocusState } from "./FocusIndicator";
import { FramingMask } from "./FramingMask";
import { LevelIndicator } from "./LevelIndicator";
import { MaskOverlay } from "./MaskOverlay";

let tapUnsupportedShown = false;

/** Fit a box of the given aspect inside the container (like object-contain, but with real geometry for overlays). */
function useFitBox(aspect: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (!cw || !ch) return;
      const w = Math.min(cw, ch * aspect);
      setBox({ width: Math.floor(w), height: Math.floor(w / aspect) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);
  return { ref, box };
}

/** Live viewfinder: full frame (never cropped), overlays aligned to the real frame, tap-to-focus. */
export function CameraPreview() {
  const api = useCameraApi();
  const [videoSize, setVideoSize] = useState({ width: 4, height: 3 });
  const { ref, box } = useFitBox(videoSize.width / videoSize.height);
  const overlays = useCameraStore((s) => s.overlays);
  const aspect = useCameraStore((s) => s.aspect);
  const zoom = useCameraStore((s) => s.digitalZoom);
  const poi = useCameraStore((s) => s.capabilities?.pointsOfInterest ?? false);
  const [focus, setFocus] = useState<{ point: { x: number; y: number }; state: FocusState } | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const { attachVideo, mirrored, focusAt } = api;
  const videoCallbackRef = useCallback(
    (el: HTMLVideoElement | null) => {
      attachVideo(el);
      setVideoEl(el);
    },
    [attachVideo],
  );

  useEffect(() => {
    const v = videoEl;
    if (!v) return;
    const onSize = () => v.videoWidth && setVideoSize({ width: v.videoWidth, height: v.videoHeight });
    v.addEventListener("loadedmetadata", onSize);
    v.addEventListener("resize", onSize);
    return () => {
      v.removeEventListener("loadedmetadata", onSize);
      v.removeEventListener("resize", onSize);
    };
  }, [videoEl]);

  useEffect(
    () => () => {
      if (focusTimer.current) clearTimeout(focusTimer.current);
    },
    [],
  );

  const frame = aspectCropRect(videoSize.width, videoSize.height, aspect);

  const onTap = async (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!poi) {
      if (!tapUnsupportedShown) {
        tapUnsupportedShown = true;
        toast.info("Tap-to-focus is not supported by this camera/browser.");
      }
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const display = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
    const raw = tapToPoint(e.clientX, e.clientY, rect, mirrored);
    // Undo the digital (CSS) zoom so the point maps to the full sensor frame.
    const point = { x: 0.5 + (raw.x - 0.5) / zoom, y: 0.5 + (raw.y - 0.5) / zoom };
    setFocus({ point: display, state: "pending" });
    const result = await focusAt(point);
    setFocus({ point: display, state: result === "confirmed" ? "confirmed" : "unconfirmed" });
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => setFocus(null), 1800);
  };

  const transform = [zoom > 1 ? `scale(${zoom})` : "", mirrored ? "scaleX(-1)" : ""].join(" ").trim() || undefined;

  return (
    <div ref={ref} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      <div
        className="relative overflow-hidden bg-neutral-900"
        style={{ width: box.width || "100%", height: box.height || "100%" }}
        onPointerUp={onTap}
        data-testid="camera-preview"
      >
        <div className="absolute inset-0" style={{ transform }}>
          <video
            ref={videoCallbackRef}
            className="size-full object-fill"
            playsInline
            muted
            autoPlay
            aria-label="Camera preview"
          />
          <MaskOverlay />
        </div>
        <FramingMask rect={frame} label={aspect !== "full" ? `${aspect} framing` : undefined} />
        <div
          className="pointer-events-none absolute"
          style={
            frame
              ? {
                  left: `${frame.x * 100}%`,
                  top: `${frame.y * 100}%`,
                  width: `${frame.width * 100}%`,
                  height: `${frame.height * 100}%`,
                }
              : { inset: 0 }
          }
        >
          <CameraGrid type={overlays.grid} />
          {overlays.centerMarker && <CenterMarker />}
        </div>
        {overlays.level && <LevelIndicator />}
        <FocusIndicator point={focus?.point ?? null} state={focus?.state ?? "pending"} />
        {(overlays.zebra || overlays.focusPeaking || overlays.clipping) && (
          <span className="pointer-events-none absolute right-1 bottom-1 rounded bg-black/60 px-1 text-[9px] text-white/70">
            Overlay from low-res preview analysis
          </span>
        )}
      </div>
    </div>
  );
}
