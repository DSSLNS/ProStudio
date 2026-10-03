"use client";

import { supportsExposureCompensation, supportsISO, supportsShutter } from "@/camera/capabilities";
import {
  formatEv,
  formatShutter,
  formatTrackExposureTime,
  isosInRange,
  shutterStopsInRange,
  trackUnitsToSeconds,
} from "@/camera/exposure";
import { useCameraStore } from "@/store/cameraStore";
import { useCameraApi } from "../CameraContext";
import { Chips, ConfirmedBadge, ControlRow, Unavailable } from "./ControlRow";
import { RangeControl } from "./RangeControl";
import { useApplyManualExposure } from "./useManualExposure";

export function IsoControl() {
  const caps = useCameraStore((s) => s.capabilities);
  const settings = useCameraStore((s) => s.settings);
  const iso = useCameraStore((s) => s.manual.iso);
  const apply = useApplyManualExposure();
  if (!caps || !supportsISO(caps)) {
    return (
      <ControlRow label="ISO">
        <Unavailable label="ISO" />
      </ControlRow>
    );
  }
  const stops = isosInRange(caps.iso);
  const values = stops.length ? stops : [caps.iso!.min, caps.iso!.max];
  const confirmed =
    iso !== null &&
    settings.exposureMode === "manual" &&
    settings.iso !== undefined &&
    Math.abs(settings.iso - iso) <= iso * 0.05;
  const status =
    iso === null ? (
      <span>Auto{settings.iso ? ` · currently ISO ${Math.round(settings.iso)}` : ""}</span>
    ) : (
      <ConfirmedBadge
        confirmed={confirmed}
        text={confirmed ? `ISO ${Math.round(settings.iso!)}` : `ISO ${iso} requested`}
      />
    );
  return (
    <ControlRow label="ISO" status={status}>
      <Chips
        label="ISO"
        value={iso === null ? "auto" : String(iso)}
        options={[
          { value: "auto", label: "Auto" },
          ...values.map((v) => ({ value: String(v), label: String(Math.round(v)) })),
        ]}
        onChange={(v) => void apply({ iso: v === "auto" ? null : Number(v) })}
      />
    </ControlRow>
  );
}

export function ShutterControl() {
  const caps = useCameraStore((s) => s.capabilities);
  const settings = useCameraStore((s) => s.settings);
  const shutter = useCameraStore((s) => s.manual.shutter);
  const apply = useApplyManualExposure();
  if (!caps || !supportsShutter(caps)) {
    return (
      <ControlRow label="Shutter speed">
        <Unavailable label="Shutter speed" />
      </ControlRow>
    );
  }
  const stops = shutterStopsInRange(caps.exposureTime);
  const reportedS = settings.exposureTime !== undefined ? trackUnitsToSeconds(settings.exposureTime) : undefined;
  const confirmed =
    shutter !== null &&
    settings.exposureMode === "manual" &&
    reportedS !== undefined &&
    Math.abs(reportedS - shutter) <= shutter * 0.06;
  const status =
    shutter === null ? (
      <span>Auto{settings.exposureTime ? ` · currently ${formatTrackExposureTime(settings.exposureTime)}` : ""}</span>
    ) : (
      <ConfirmedBadge
        confirmed={confirmed}
        text={confirmed ? formatShutter(reportedS!) : `${formatShutter(shutter)} requested`}
      />
    );
  return (
    <ControlRow label="Shutter speed" status={status}>
      <Chips
        label="Shutter speed"
        value={shutter === null ? "auto" : String(shutter)}
        options={[
          { value: "auto", label: "Auto" },
          ...stops.map((s) => ({ value: String(s), label: formatShutter(s) })),
        ]}
        onChange={(v) => void apply({ shutter: v === "auto" ? null : Number(v) })}
      />
      <p className="text-[11px] text-white/50">
        Device range {formatTrackExposureTime(caps.exposureTime!.min)} –{" "}
        {formatTrackExposureTime(caps.exposureTime!.max)}
        {shutter !== null && shutter > 1 / 30 ? " · Slow shutter: hold steady or use a tripod" : ""}
      </p>
    </ControlRow>
  );
}

export function EvControl() {
  const api = useCameraApi();
  const caps = useCameraStore((s) => s.capabilities);
  const settings = useCameraStore((s) => s.settings);
  const ev = useCameraStore((s) => s.manual.ev);
  const setManual = useCameraStore((s) => s.setManual);
  if (caps && supportsExposureCompensation(caps)) {
    const r = caps.exposureCompensation!;
    const reported = settings.exposureCompensation;
    return (
      <ControlRow
        label="Exposure compensation"
        status={
          reported !== undefined ? (
            <ConfirmedBadge confirmed={Math.abs(reported - ev) < 0.05} text={`Camera: ${formatEv(reported)}`} />
          ) : null
        }
      >
        <RangeControl
          label="EV (device)"
          value={ev}
          min={r.min}
          max={r.max}
          step={r.step}
          format={formatEv}
          onCommit={(v) => {
            setManual({ ev: v });
            void api.applySettings({ exposureCompensation: v }, "Exposure compensation");
          }}
        />
        {settings.exposureMode === "manual" && (
          <p className="text-[11px] text-amber-200/80">Compensation may have no effect while ISO/shutter are manual.</p>
        )}
      </ControlRow>
    );
  }
  return (
    <ControlRow label="Exposure compensation">
      <Unavailable label="Exposure compensation (device)" />
      <RangeControl
        label="Digital exposure adjustment (software correction)"
        value={ev}
        min={-2}
        max={2}
        step={0.1}
        format={formatEv}
        onCommit={(v) => setManual({ ev: v })}
      />
      <p className="text-[11px] text-white/50">
        Saved in the photo&apos;s edit recipe — not visible in the live preview, original pixels untouched.
      </p>
    </ControlRow>
  );
}

export function ApertureControl() {
  return (
    <ControlRow label="Aperture">
      <Unavailable label="Aperture" reason="not controllable from the browser (no web API exists)" />
    </ControlRow>
  );
}
