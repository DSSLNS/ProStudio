"use client";

import { AutoInsights } from "./AutoInsights";
import { CameraScreen } from "./CameraScreen";

/** Auto mode: the AutoCameraEngine analyses the scene and applies only what the device supports. */
export function AutoCamera() {
  return <CameraScreen mode="auto" panelTitle="Auto analysis" panelLabel="Analysis" panel={<AutoInsights />} />;
}
