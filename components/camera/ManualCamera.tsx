"use client";

import { CameraControls } from "./CameraControls";
import { CameraScreen } from "./CameraScreen";

/** Manual mode: real hardware controls where reported, honest "not available" otherwise. */
export function ManualCamera() {
  return <CameraScreen mode="manual" panelTitle="Manual controls" panelLabel="Controls" panel={<CameraControls />} />;
}
