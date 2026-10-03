"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ExportFormat = "jpeg" | "png" | "webp" | "avif" | "tiff";
export type PerformanceMode = "quality" | "balanced" | "performance";
export type GridType = "none" | "thirds" | "golden" | "center" | "square";
export type HistogramMode = "luma" | "rgb";
export type CameraModePref = "auto" | "manual";

/**
 * Small, user-facing preferences. Persisted to localStorage (tiny JSON only —
 * images and projects live in IndexedDB, never here).
 */
export interface UiPreferences {
  defaultExportFormat: ExportFormat;
  defaultJpegQuality: number; // 1–100
  autoSave: boolean;
  preserveMetadata: boolean;
  stripLocationOnExport: boolean;
  defaultCameraMode: CameraModePref;
  preferredFacing: "environment" | "user";
  mirrorSelfie: boolean;
  grid: GridType;
  histogram: HistogramMode;
  showHistogram: boolean;
  showLevel: boolean;
  performanceMode: PerformanceMode;
  gpuAcceleration: boolean;
  highContrast: boolean;
  localAiOnly: boolean;
}

interface UiState extends UiPreferences {
  set: <K extends keyof UiPreferences>(key: K, value: UiPreferences[K]) => void;
  reset: () => void;
}

export const DEFAULT_PREFERENCES: UiPreferences = {
  defaultExportFormat: "jpeg",
  defaultJpegQuality: 92,
  autoSave: true,
  preserveMetadata: true,
  stripLocationOnExport: true,
  defaultCameraMode: "auto",
  preferredFacing: "environment",
  mirrorSelfie: true,
  grid: "thirds",
  histogram: "luma",
  showHistogram: true,
  showLevel: true,
  performanceMode: "balanced",
  gpuAcceleration: true,
  highContrast: false,
  localAiOnly: true,
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFERENCES,
      set: (key, value) => set({ [key]: value } as Pick<UiPreferences, typeof key>),
      reset: () => set(DEFAULT_PREFERENCES),
    }),
    {
      name: "prostudio.prefs.v1",
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);

/** Long edge (px) used for the interactive editor preview in each mode. */
export function previewLongEdge(mode: PerformanceMode): number {
  switch (mode) {
    case "quality":
      return 4096;
    case "balanced":
      return 2560;
    case "performance":
      return 1600;
  }
}
