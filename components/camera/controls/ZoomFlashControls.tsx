"use client";

import { supportsFlash, supportsZoom } from "@/camera/capabilities";
import type { FlashMode } from "@/camera/capture";
import { Switch } from "@/components/ui/switch";
import { useCameraStore } from "@/store/cameraStore";
import { useCameraApi } from "../CameraContext";
import { Chips, ConfirmedBadge, ControlRow, Unavailable } from "./ControlRow";
import { RangeControl } from "./RangeControl";

export function ZoomControls() {
  const api = useCameraApi();
  const caps = useCameraStore((s) => s.capabilities);
  const zoom = useCameraStore((s) => s.settings.zoom);
  const digital = useCameraStore((s) => s.digitalZoom);
  const set = useCameraStore((s) => s.set);
  if (!caps) return null;
  return (
    <ControlRow label="Zoom">
      {supportsZoom(caps) ? (
        <RangeControl
          label="Zoom (device)"
          value={zoom ?? caps.zoom!.min}
          min={caps.zoom!.min}
          max={caps.zoom!.max}
          step={caps.zoom!.step}
          format={(v) => `${v.toFixed(1)}×`}
          onCommit={(v) => void api.applySettings({ zoom: v }, "Zoom")}
        />
      ) : (
        <Unavailable label="Zoom (device)" />
      )}
      <RangeControl
        label="Digital zoom (crop — reduces resolution)"
        value={digital}
        min={1}
        max={4}
        step={0.1}
        format={(v) => `${v.toFixed(1)}×`}
        onCommit={(v) => set("digitalZoom", v)}
      />
      <p className="text-[11px] text-white/50">
        Digital zoom is stored as a non-destructive crop; the full frame is kept.
      </p>
    </ControlRow>
  );
}

const FLASH_LABELS: Record<FlashMode, string> = { auto: "Auto", flash: "On", off: "Off" };

export function FlashControls() {
  const api = useCameraApi();
  const caps = useCameraStore((s) => s.capabilities);
  const flash = useCameraStore((s) => s.flash);
  const torch = useCameraStore((s) => s.settings.torch);
  const set = useCameraStore((s) => s.set);
  if (!caps) return null;
  const modes = (["auto", "flash", "off"] as FlashMode[]).filter(
    (m) => m === "off" || caps.photo?.fillLightMode.includes(m),
  );
  return (
    <ControlRow
      label="Flash & torch"
      status={
        caps.torch && torch !== undefined ? <ConfirmedBadge confirmed text={`Torch ${torch ? "on" : "off"}`} /> : null
      }
    >
      {supportsFlash(caps) ? (
        <Chips
          label="Flash"
          value={flash}
          options={modes.map((m) => ({ value: m, label: FLASH_LABELS[m] }))}
          onChange={(m) => set("flash", m)}
        />
      ) : (
        <Unavailable label="Flash" />
      )}
      {caps.torch ? (
        <div className="flex items-center justify-between">
          <label htmlFor="ctl-torch" className="text-sm">
            Torch
          </label>
          <Switch
            id="ctl-torch"
            checked={!!torch}
            onCheckedChange={(v) => void api.applySettings({ torch: !!v }, "Torch")}
          />
        </div>
      ) : (
        <Unavailable label="Torch" />
      )}
    </ControlRow>
  );
}
