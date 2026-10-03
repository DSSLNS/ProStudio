"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { BrushParams, CombineMode } from "@/types/layers";

/** Tool options (persisted between sessions, small JSON only). */
interface ToolState {
  brush: BrushParams;
  color: string;
  /** Mask painting: reveal (paint white) or hide (paint black). */
  maskPaint: "reveal" | "hide";
  smoothing: number; // 0..0.9
  gradientKind: "linear" | "radial";
  selectionMode: Exclude<CombineMode, "replace"> | "new";
  wandTolerance: number; // 0..100
  wandContiguous: boolean;
  bgEraserTolerance: number; // 0..100
  retouchStrength: number; // 0..1
  cloneAligned: boolean;
  dodgeRange: "shadows" | "midtones" | "highlights";
  dustThreshold: number; // 0..1
  set: (patch: Partial<Omit<ToolState, "set" | "setBrush">>) => void;
  setBrush: (patch: Partial<BrushParams>) => void;
}

export const useToolStore = create<ToolState>()(
  persist(
    (set, get) => ({
      brush: { size: 80, hardness: 0.6, opacity: 1, flow: 0.8, spacing: 0.15, pressureSize: true },
      color: "#ffffff",
      maskPaint: "hide",
      smoothing: 0.4,
      gradientKind: "linear",
      selectionMode: "new",
      wandTolerance: 24,
      wandContiguous: true,
      bgEraserTolerance: 25,
      retouchStrength: 0.5,
      cloneAligned: true,
      dodgeRange: "midtones",
      dustThreshold: 0.12,
      set: (patch) => set(patch),
      setBrush: (patch) => set({ brush: { ...get().brush, ...patch } }),
    }),
    { name: "prostudio.tools.v1", storage: createJSONStorage(() => localStorage), version: 1 },
  ),
);
