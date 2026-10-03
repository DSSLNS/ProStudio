"use client";

import { formatMegapixels } from "@/lib/fileUtils";
import { Switch } from "@/components/ui/switch";
import type { GridType } from "@/store/uiStore";
import {
  RESOLUTION_PRESETS,
  useCameraStore,
  type BurstCount,
  type HistogramOverlay,
  type Overlays,
  type ResolutionChoice,
} from "@/store/cameraStore";
import { useCameraApi } from "./CameraContext";
import { CapabilityList } from "./CapabilityList";
import { NativeSelect } from "./NativeSelect";

function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <label htmlFor={id} className="text-sm">
        {label}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={(v) => onChange(!!v)} />
    </div>
  );
}

/** Resolution, overlays, burst, mirroring, devices and the capability table. */
export function CameraSettingsPanel() {
  const api = useCameraApi();
  const s = useCameraStore();
  const caps = s.capabilities;
  const maxEdge = caps?.width && caps.height ? Math.max(caps.width.max, caps.height.max) : null;
  const presets = RESOLUTION_PRESETS.filter((p) => maxEdge === null || p.width <= maxEdge);
  const ov = s.overlays;
  const setOv =
    <K extends keyof Overlays>(k: K) =>
    (v: Overlays[K]) =>
      s.setOverlay(k, v);
  const photoMax =
    caps?.photo?.imageWidth && caps.photo.imageHeight
      ? formatMegapixels(caps.photo.imageWidth.max, caps.photo.imageHeight.max)
      : null;

  return (
    <div className="flex flex-col gap-4 pb-2 text-sm">
      <section aria-labelledby="set-res" className="flex flex-col gap-2">
        <h3 id="set-res" className="text-xs font-semibold uppercase tracking-wider text-white/70">
          Resolution
        </h3>
        <NativeSelect
          aria-label="Preview stream resolution"
          value={s.resolution}
          onChange={(e) => void api.setResolution(e.target.value as ResolutionChoice)}
        >
          <option value="max">Highest available</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-white/60">
          Stream: {s.streamSize ? formatMegapixels(s.streamSize.width, s.streamSize.height) : "—"}
          {photoMax ? ` · Photo (ImageCapture): up to ${photoMax}` : " · Photos use the stream resolution"}
        </p>
      </section>

      {s.devices.length > 1 && (
        <section aria-labelledby="set-dev" className="flex flex-col gap-2">
          <h3 id="set-dev" className="text-xs font-semibold uppercase tracking-wider text-white/70">
            Camera
          </h3>
          <NativeSelect
            aria-label="Camera device"
            value={s.deviceId ?? ""}
            onChange={(e) => void api.selectDevice(e.target.value)}
          >
            {s.devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </NativeSelect>
        </section>
      )}

      <section aria-labelledby="set-ov" className="flex flex-col">
        <h3 id="set-ov" className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/70">
          Overlays
        </h3>
        <div className="flex items-center justify-between gap-3 py-1.5">
          <label htmlFor="ov-grid">Grid</label>
          <NativeSelect id="ov-grid" value={ov.grid} onChange={(e) => setOv("grid")(e.target.value as GridType)}>
            <option value="none">None</option>
            <option value="thirds">Rule of thirds</option>
            <option value="golden">Golden ratio</option>
            <option value="center">Center cross</option>
            <option value="square">Square</option>
          </NativeSelect>
        </div>
        <div className="flex items-center justify-between gap-3 py-1.5">
          <label htmlFor="ov-hist">Histogram</label>
          <NativeSelect
            id="ov-hist"
            value={ov.histogram}
            onChange={(e) => setOv("histogram")(e.target.value as HistogramOverlay)}
          >
            <option value="off">Off</option>
            <option value="luma">Luminance</option>
            <option value="rgb">RGB</option>
          </NativeSelect>
        </div>
        <Toggle id="ov-meter" label="Exposure meter" checked={ov.exposureMeter} onChange={setOv("exposureMeter")} />
        <Toggle id="ov-zebra" label="Zebra (highlights ≥ 95%)" checked={ov.zebra} onChange={setOv("zebra")} />
        <Toggle id="ov-clip" label="Clipping warnings" checked={ov.clipping} onChange={setOv("clipping")} />
        <Toggle id="ov-peak" label="Focus peaking" checked={ov.focusPeaking} onChange={setOv("focusPeaking")} />
        <Toggle id="ov-level" label="Level (needs motion sensors)" checked={ov.level} onChange={setOv("level")} />
        <Toggle id="ov-center" label="Center marker" checked={ov.centerMarker} onChange={setOv("centerMarker")} />
      </section>

      <section aria-labelledby="set-cap" className="flex flex-col">
        <h3 id="set-cap" className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/70">
          Capture
        </h3>
        <div className="flex items-center justify-between gap-3 py-1.5">
          <label htmlFor="cap-burst">Burst</label>
          <NativeSelect
            id="cap-burst"
            value={s.burst}
            onChange={(e) => s.set("burst", Number(e.target.value) as BurstCount)}
          >
            {[1, 3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "Off" : `${n} photos`}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Toggle
          id="cap-mirror"
          label="Mirror front-camera photos"
          checked={s.mirrorSelfie}
          onChange={(v) => s.set("mirrorSelfie", v)}
        />
      </section>

      {caps && (
        <section aria-labelledby="set-caps" className="flex flex-col gap-2">
          <h3 id="set-caps" className="text-xs font-semibold uppercase tracking-wider text-white/70">
            What this camera supports
          </h3>
          <CapabilityList caps={caps} imageCapture={s.imageCaptureAvailable} />
        </section>
      )}
    </div>
  );
}
