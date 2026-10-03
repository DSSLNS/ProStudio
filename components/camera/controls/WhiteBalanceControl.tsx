"use client";

import { supportsKelvin } from "@/camera/capabilities";
import { presetsInRange, softwareTemperatureFor, WB_PRESETS } from "@/camera/whiteBalance";
import { useCameraStore } from "@/store/cameraStore";
import { useCameraApi } from "../CameraContext";
import { Chips, ConfirmedBadge, ControlRow, Unavailable } from "./ControlRow";
import { RangeControl } from "./RangeControl";

export function WhiteBalanceControl() {
  const api = useCameraApi();
  const caps = useCameraStore((s) => s.capabilities);
  const settings = useCameraStore((s) => s.settings);
  const wb = useCameraStore((s) => s.manual.wb);
  const setManual = useCameraStore((s) => s.setManual);
  const estimate = useCameraStore((s) => s.analysis?.stats.whiteBalance.cct);

  if (caps && supportsKelvin(caps)) {
    const range = caps.colorTemperature!;
    const presets = presetsInRange(range);
    const kelvin = wb.kind === "kelvin" ? wb.kelvin : (settings.colorTemperature ?? 5500);
    const applyKelvin = (k: number) => {
      setManual({ wb: { kind: "kelvin", kelvin: k } });
      void api.applySettings({ whiteBalanceMode: "manual", colorTemperature: k }, "White balance");
    };
    const confirmed =
      wb.kind === "kelvin" &&
      settings.whiteBalanceMode === "manual" &&
      settings.colorTemperature !== undefined &&
      Math.abs(settings.colorTemperature - wb.kelvin) < 150;
    return (
      <ControlRow
        label="White balance"
        status={
          wb.kind === "kelvin" ? (
            <ConfirmedBadge
              confirmed={confirmed}
              text={confirmed ? `${Math.round(settings.colorTemperature!)} K` : `${wb.kelvin} K requested`}
            />
          ) : (
            "Auto (camera)"
          )
        }
      >
        <Chips
          label="White balance preset"
          value={
            wb.kind === "auto"
              ? "auto"
              : (presets.find((p) => wb.kind === "kelvin" && p.kelvin === wb.kelvin)?.id ?? "custom")
          }
          options={[
            { value: "auto", label: "Auto" },
            ...presets.map((p) => ({ value: p.id, label: `${p.label} ${p.kelvin}K` })),
          ]}
          onChange={(v) => {
            if (v === "auto") {
              setManual({ wb: { kind: "auto" } });
              if (caps.whiteBalanceMode.includes("continuous"))
                void api.applySettings({ whiteBalanceMode: "continuous" }, "White balance");
            } else {
              const p = presets.find((x) => x.id === v);
              if (p) applyKelvin(p.kelvin);
            }
          }}
        />
        <RangeControl
          label="Kelvin (device)"
          value={kelvin}
          min={range.min}
          max={range.max}
          step={range.step || 50}
          format={(v) => `${Math.round(v)} K`}
          onCommit={applyKelvin}
        />
      </ControlRow>
    );
  }

  const softValue =
    wb.kind === "software" ? (WB_PRESETS.find((p) => p.kelvin === wb.presetKelvin)?.id ?? "auto") : "auto";
  return (
    <ControlRow label="White balance">
      <Unavailable label="White balance (Kelvin)" />
      <p className="text-xs text-white/70">
        Software correction (saved in the photo&apos;s edit recipe, not shown in the live preview):
      </p>
      <Chips
        label="Software white balance"
        value={softValue}
        options={[{ value: "auto", label: "Camera auto" }, ...WB_PRESETS.map((p) => ({ value: p.id, label: p.label }))]}
        onChange={(v) => {
          const p = WB_PRESETS.find((x) => x.id === v);
          setManual({ wb: p ? { kind: "software", presetKelvin: p.kelvin, label: p.label } : { kind: "auto" } });
        }}
      />
      {wb.kind === "software" && (
        <p className="text-[11px] text-white/50">
          Temperature correction {softwareTemperatureFor(wb.presetKelvin)} will be stored with the photo.
        </p>
      )}
      {estimate && <p className="text-[11px] text-white/50">Estimated light: ~{estimate} K (gray-world estimate)</p>}
    </ControlRow>
  );
}
