"use client";

import { sceneStatusText } from "@/camera/sceneDetection";
import { useCameraStore } from "@/store/cameraStore";

/** Unobtrusive scene label. Heuristic — always marked as an estimate where relevant. */
export function SceneIndicator() {
  const scene = useCameraStore((s) => s.analysis?.scene);
  if (!scene) return null;
  return (
    <div
      className="pointer-events-none rounded-full bg-black/55 px-3 py-1 text-xs text-white"
      role="status"
      aria-live="polite"
      title={scene.reasons.join("; ")}
    >
      {sceneStatusText(scene)}
      {scene.faceDetection === "unavailable" && (
        <span className="ml-1 text-white/60">· face detection unavailable</span>
      )}
    </div>
  );
}
