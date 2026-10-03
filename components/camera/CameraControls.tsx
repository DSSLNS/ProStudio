"use client";

import { ApertureControl, EvControl, IsoControl, ShutterControl } from "./controls/ExposureControls";
import { FocusControl } from "./controls/FocusControl";
import { WhiteBalanceControl } from "./controls/WhiteBalanceControl";
import { FlashControls, ZoomControls } from "./controls/ZoomFlashControls";

/** Manual controls. Each control is real when the device reports it, otherwise shown as unavailable. */
export function CameraControls() {
  return (
    <div className="divide-y divide-white/10" data-testid="manual-controls">
      <IsoControl />
      <ShutterControl />
      <ApertureControl />
      <EvControl />
      <WhiteBalanceControl />
      <FocusControl />
      <ZoomControls />
      <FlashControls />
    </div>
  );
}
