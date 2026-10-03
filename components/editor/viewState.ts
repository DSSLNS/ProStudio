"use client";

import { create } from "zustand";
import type { CropRect } from "@/types/edit";

/** Ephemeral UI state that changes at pointer rate (kept out of the main editor store). */
interface ViewState {
  pointer: { x: number; y: number; rgb: [number, number, number] | null } | null;
  /** Crop being edited (normalised to the warped frame) while the crop tool is active. */
  draftCrop: CropRect | null;
  /** Locked aspect (w/h of the output in pixels) or null for free. */
  cropAspect: number | null;
  /** Current displayed canvas rect relative to the viewport container. */
  displayRect: { left: number; top: number; width: number; height: number } | null;
  renderInfo: { width: number; height: number; backend: "webgl2" | "cpu"; ms: number } | null;
  histogramVersion: number;
  /** Clone/heal source point (frame px) and the aligned offset established by the first stroke. */
  cloneSource: [number, number] | null;
  cloneOffset: [number, number] | null;
  /** Next tap sets the clone source (touch devices have no Alt key). */
  pickingSource: boolean;
  /** Layers the current renderer cannot draw (shown as a warning). */
  unsupported: string[];
  set: (patch: Partial<Omit<ViewState, "set">>) => void;
}

export const useViewState = create<ViewState>()((set) => ({
  pointer: null,
  draftCrop: null,
  cropAspect: null,
  displayRect: null,
  renderInfo: null,
  histogramVersion: 0,
  unsupported: [],
  cloneSource: null,
  cloneOffset: null,
  pickingSource: false,
  set: (patch) => set(patch),
}));
