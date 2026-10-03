"use client";

import { useCallback } from "react";
import { buildManualExposureSet } from "@/camera/exposure";
import { useCameraStore } from "@/store/cameraStore";
import { useCameraApi } from "../CameraContext";

/** Apply the manual ISO/shutter intent (both go together because they need exposureMode "manual"). */
export function useApplyManualExposure() {
  const api = useCameraApi();
  return useCallback(
    async (patch: { iso?: number | null; shutter?: number | null }) => {
      const st = useCameraStore.getState();
      st.setManual(patch);
      const m = { ...st.manual, ...patch };
      const caps = st.capabilities;
      if (!caps) return;
      const set = buildManualExposureSet({
        iso: m.iso,
        shutterSeconds: m.shutter,
        currentIso: st.settings.iso,
        currentExposureTime: st.settings.exposureTime,
        isoRange: caps.iso,
        exposureTimeRange: caps.exposureTime,
        exposureModes: caps.exposureMode,
      });
      if (set) await api.applySettings(set, "Exposure");
    },
    [api],
  );
}
