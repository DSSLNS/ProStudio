"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { CameraApi } from "@/hooks/useCamera";

const CameraContext = createContext<CameraApi | null>(null);

export function CameraProvider({ api, children }: { api: CameraApi; children: ReactNode }) {
  return <CameraContext.Provider value={api}>{children}</CameraContext.Provider>;
}

export function useCameraApi(): CameraApi {
  const ctx = useContext(CameraContext);
  if (!ctx) throw new Error("useCameraApi must be used inside <CameraProvider>.");
  return ctx;
}
