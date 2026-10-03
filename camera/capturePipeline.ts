"use client";

/**
 * Orchestrates a capture from the UI: self-timer countdown, burst, multi-frame
 * modes, and building the non-destructive recipe. Burst shots are stored as
 * projects immediately; single shots go to the review screen.
 */

import { toast } from "sonner";
import { createProjectFromFile } from "@/storage/projects";
import { useCameraStore, type CapturedPhoto } from "@/store/cameraStore";
import type { AutoCameraEngine } from "./autoCamera";
import { buildCaptureRecipe } from "./captureRecipe";
import { captureFileName, extensionFor } from "./capture";
import { softwareTemperatureFor } from "./whiteBalance";
import type { EditRecipe } from "@/types/edit";
import { defaultRecipe } from "@/types/edit";

function countdown(seconds: number, registerCancel: (fn: () => void) => void): Promise<boolean> {
  const store = useCameraStore.getState();
  return new Promise((resolve) => {
    let remaining = seconds;
    store.set("countdown", remaining);
    const id = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(id);
        store.set("countdown", null);
        resolve(true);
      } else store.set("countdown", remaining);
    }, 1000);
    registerCancel(() => {
      clearInterval(id);
      store.set("countdown", null);
      resolve(false);
    });
  });
}

export async function runCapture(opts: {
  engine: AutoCameraEngine;
  registerCancel: (fn: () => void) => void;
  isFront: boolean;
}): Promise<void> {
  const { engine } = opts;
  const initial = useCameraStore.getState();
  if (initial.timer > 0) {
    const go = await countdown(initial.timer, opts.registerCancel);
    if (!go) return;
  }
  const s = useCameraStore.getState();
  if (s.status !== "live") return;
  s.set("capturing", true);
  const kind = s.captureKind;
  const count = kind === "single" ? s.burst : 1;
  const photos: CapturedPhoto[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const analysis = useCameraStore.getState().analysis;
      const res = await engine.capture({
        kind,
        flash: s.flash,
        onProgress: kind === "single" ? undefined : (f) => useCameraStore.getState().set("captureProgress", f),
      });
      const corrections: string[] = [];
      let base: EditRecipe = defaultRecipe();
      if (s.mode === "auto" && kind === "single") {
        const applied = useCameraStore.getState().applied;
        const opt = engine.optimizeCapturedImage(analysis, {
          hardwareExposureApplied: applied.exposureCompensation !== undefined || applied.iso !== undefined,
          hardwareWbApplied: applied.colorTemperature !== undefined,
        });
        base = opt.recipe;
        corrections.push(...opt.corrections);
      } else if (s.mode === "manual" && s.manual.wb.kind === "software") {
        base.color.temperature = softwareTemperatureFor(s.manual.wb.presetKelvin);
        corrections.push(
          `White balance "${s.manual.wb.label}" temperature ${base.color.temperature} (software correction)`,
        );
      }
      if (s.mode === "manual" && Math.abs(s.manual.ev) > 0.01 && !s.capabilities?.exposureCompensation) {
        base.light.exposure = s.manual.ev;
        corrections.push(
          `Digital exposure adjustment ${s.manual.ev > 0 ? "+" : ""}${s.manual.ev.toFixed(1)} EV (software correction)`,
        );
      }
      const mirror = opts.isFront && s.mirrorSelfie;
      const recipe = buildCaptureRecipe({
        width: res.width,
        height: res.height,
        aspect: s.aspect,
        digitalZoom: s.digitalZoom,
        mirror,
        corrections: base,
      });
      if (s.aspect !== "full") corrections.push(`Framing ${s.aspect} (non-destructive crop)`);
      if (s.digitalZoom > 1.001) corrections.push(`Digital zoom ${s.digitalZoom.toFixed(1)}× (non-destructive crop)`);
      if (mirror) corrections.push("Mirrored selfie (non-destructive flip)");
      photos.push({
        blob: res.blob,
        url: URL.createObjectURL(res.blob),
        width: res.width,
        height: res.height,
        mimeType: res.mimeType,
        method: res.method,
        note: res.note,
        recipe,
        corrections,
        capturedAt: Date.now(),
      });
    }
    if (photos.length > 1) {
      for (const p of photos) {
        const project = await createProjectFromFile(p.blob, {
          name: captureFileName(new Date(p.capturedAt), extensionFor(p.mimeType)).replace(/\.\w+$/, ""),
          origin: "camera",
          recipe: p.recipe,
        });
        p.projectId = project.id;
      }
      toast.success(`Burst: ${photos.length} photos saved to Projects.`);
      photos.slice(0, -1).forEach((p) => URL.revokeObjectURL(p.url));
    }
    useCameraStore.getState().setLastCapture(photos[photos.length - 1] ?? null);
  } catch (e) {
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    toast.error((e as Error)?.message || "Capture failed.");
  } finally {
    useCameraStore.setState({ capturing: false, captureProgress: null });
  }
}
