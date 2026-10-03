"use client";

import { formatEv, formatShutter, formatTrackExposureTime } from "@/camera/exposure";
import { describeKelvin } from "@/camera/whiteBalance";
import { useCameraStore } from "@/store/cameraStore";
import { ConfirmedBadge } from "./controls/ControlRow";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-t border-white/10 py-1.5 text-sm first:border-t-0">
      <dt className="text-white/60">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

/** What Auto mode sees, recommends, and has actually applied (confirmed by the camera). */
export function AutoInsights() {
  const a = useCameraStore((s) => s.analysis);
  const applied = useCameraStore((s) => s.applied);
  if (!a) return <p className="py-4 text-sm text-white/60">Analysing the scene…</p>;
  const r = a.recommended;
  return (
    <div className="flex flex-col gap-3 pb-2" data-testid="auto-insights">
      <dl>
        <Row
          label="Scene (estimated)"
          value={
            <span title={a.scene.reasons.join("; ")}>
              {a.scene.label} · {Math.round(a.scene.confidence * 100)}%
            </span>
          }
        />
        {a.scene.flags.length > 0 && <Row label="Also" value={a.scene.flags.join(", ")} />}
        <Row
          label="Faces"
          value={
            a.scene.faceDetection === "unavailable"
              ? "Face detection unavailable in this browser"
              : `${a.scene.faceCount} detected`
          }
        />
        <Row label="Brightness (meter)" value={formatEv(a.brightness.evOffset)} />
        <Row
          label="Light"
          value={`${a.lighting.level}${a.lighting.backlit ? ", backlit" : ""} · ~${a.lighting.kelvin} K ${describeKelvin(a.lighting.kelvin)}`}
        />
        <Row label="Dynamic range (preview)" value={`${a.stats.dynamicRange.toFixed(1)} stops`} />
        <Row label="Motion" value={a.motion > 0.06 ? "Moving subject" : a.motion > 0.02 ? "Some movement" : "Still"} />
      </dl>

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/70">Recommendations</h3>
        <dl>
          <Row
            label="Exposure"
            value={`${formatEv(r.evCorrection)} (${a.exposure.meteredOn === "faces" ? "metered on faces" : "centre-weighted"}${a.exposure.highlightProtected ? ", highlight protection" : ""}${a.exposure.shadowProtected ? ", shadow protection" : ""})`}
          />
          <Row
            label="ISO / shutter"
            value={
              r.iso && r.shutterSeconds ? (
                <span>
                  ISO {r.iso} · {formatShutter(r.shutterSeconds)}
                  <span className="block text-[11px] text-white/60">{r.isoShutterNote}</span>
                </span>
              ) : (
                <span className="text-white/60">{r.isoShutterNote}</span>
              )
            }
          />
          <Row
            label="White balance"
            value={
              r.whiteBalance.neutral
                ? "Neutral — no correction"
                : `~${r.whiteBalance.estimatedKelvin} K → software correction temp ${r.whiteBalance.softwareTemperature}, tint ${r.whiteBalance.softwareTint}`
            }
          />
          <Row label="Focus" value={r.focus.reason} />
          {r.nightModeSuggested && (
            <Row label="Night" value="Low light — Night (multi-frame) available in the top bar" />
          )}
        </dl>
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-white/70">
          Applied to the camera (confirmed)
        </h3>
        {Object.keys(applied).length === 0 ? (
          <p className="text-sm text-white/60">Nothing applied — the camera is using its own automatic settings.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {applied.exposureMode && (
              <li>
                <ConfirmedBadge confirmed text={`Exposure mode: ${applied.exposureMode}`} />
              </li>
            )}
            {applied.exposureCompensation !== undefined && (
              <li>
                <ConfirmedBadge confirmed text={`EV comp ${formatEv(applied.exposureCompensation)}`} />
              </li>
            )}
            {applied.iso !== undefined && (
              <li>
                <ConfirmedBadge confirmed text={`ISO ${Math.round(applied.iso)}`} />
              </li>
            )}
            {applied.exposureTime !== undefined && (
              <li>
                <ConfirmedBadge confirmed text={`Shutter ${formatTrackExposureTime(applied.exposureTime)}`} />
              </li>
            )}
            {applied.whiteBalanceMode && (
              <li>
                <ConfirmedBadge confirmed text={`WB: ${applied.whiteBalanceMode}`} />
              </li>
            )}
            {applied.colorTemperature !== undefined && (
              <li>
                <ConfirmedBadge confirmed text={`${Math.round(applied.colorTemperature)} K`} />
              </li>
            )}
            {applied.focusMode && (
              <li>
                <ConfirmedBadge confirmed text={`Focus: ${applied.focusMode}`} />
              </li>
            )}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-white/50">
          After capture, any remaining exposure/white-balance difference is saved as a software correction in the edit
          recipe — the original photo is never altered.
        </p>
      </div>
    </div>
  );
}
