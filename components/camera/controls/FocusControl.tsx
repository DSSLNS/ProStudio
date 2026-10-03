"use client";

import { focusOptions, focusQuality, formatFocusDistance, type FocusChoice } from "@/camera/focus";
import { useCameraStore } from "@/store/cameraStore";
import { useCameraApi } from "../CameraContext";
import { Chips, ConfirmedBadge, ControlRow, Unavailable } from "./ControlRow";
import { RangeControl } from "./RangeControl";

export function FocusControl() {
  const api = useCameraApi();
  const caps = useCameraStore((s) => s.capabilities);
  const settings = useCameraStore((s) => s.settings);
  const choice = useCameraStore((s) => s.manual.focus);
  const setManual = useCameraStore((s) => s.setManual);
  const sharp = useCameraStore((s) => s.analysis?.stats.centerSharpness);
  if (!caps) return null;
  const options = focusOptions(caps).filter((o) => o.available);
  const quality = sharp !== undefined ? focusQuality(sharp) : null;

  const select = (v: FocusChoice) => {
    const o = options.find((x) => x.value === v);
    if (!o?.trackMode) return;
    setManual({ focus: v });
    const set: { focusMode: string; focusDistance?: number } = { focusMode: o.trackMode };
    if (v === "locked" && settings.focusDistance !== undefined && o.trackMode === "manual")
      set.focusDistance = settings.focusDistance;
    void api.applySettings(set, "Focus");
  };

  return (
    <ControlRow
      label="Focus"
      status={settings.focusMode ? <ConfirmedBadge confirmed text={`Camera: ${settings.focusMode}`} /> : null}
    >
      {options.length === 0 ? (
        <Unavailable label="Focus mode control" />
      ) : (
        <Chips
          label="Focus mode"
          value={choice}
          options={options.map((o) => ({ value: o.value, label: o.label }))}
          onChange={select}
        />
      )}
      {choice === "manual" && caps.focusDistance && (
        <RangeControl
          label="Focus distance (device units)"
          value={settings.focusDistance ?? caps.focusDistance.min}
          min={caps.focusDistance.min}
          max={caps.focusDistance.max}
          step={caps.focusDistance.step}
          format={formatFocusDistance}
          onCommit={(d) => void api.applySettings({ focusMode: "manual", focusDistance: d }, "Focus distance")}
        />
      )}
      {!options.some((o) => o.value === "manual") && <Unavailable label="Manual focus distance" />}
      {caps.pointsOfInterest ? (
        <p className="text-[11px] text-white/60">Tap the preview to set the focus/metering point.</p>
      ) : (
        <Unavailable label="Tap-to-focus" />
      )}
      {quality !== null && (
        <div className="flex items-center gap-2 text-[11px] text-white/60">
          <span>Centre sharpness (measured)</span>
          <div
            className="h-1.5 flex-1 rounded bg-white/15"
            role="meter"
            aria-label="Centre sharpness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(quality * 100)}
          >
            <div className="h-full rounded bg-emerald-300" style={{ width: `${quality * 100}%` }} />
          </div>
        </div>
      )}
    </ControlRow>
  );
}
