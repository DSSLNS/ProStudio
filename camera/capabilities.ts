/**
 * Normalises what the browser *actually* reports about a camera into one typed
 * structure. Nothing here is assumed: a capability is only "supported" when
 * MediaStreamTrack.getCapabilities() or ImageCapture.getPhotoCapabilities()
 * reports it with a usable range / mode list.
 *
 * Units are kept exactly as the track reports them. In particular
 * `exposureTime` is in units of 100 µs in Chrome (see camera/exposure.ts).
 */

import { formatTrackExposureTime } from "./exposure";

export interface NumericRange {
  min: number;
  max: number;
  step: number;
}

export interface PhotoCapabilitiesInfo {
  imageWidth: NumericRange | null;
  imageHeight: NumericRange | null;
  fillLightMode: string[];
  redEyeReduction: boolean;
}

export interface CameraCapabilities {
  deviceId: string | null;
  facingMode: string[];
  width: NumericRange | null;
  height: NumericRange | null;
  frameRate: NumericRange | null;
  exposureMode: string[];
  exposureCompensation: NumericRange | null;
  /** Track units (100 µs in Chrome). */
  exposureTime: NumericRange | null;
  iso: NumericRange | null;
  whiteBalanceMode: string[];
  colorTemperature: NumericRange | null;
  focusMode: string[];
  focusDistance: NumericRange | null;
  zoom: NumericRange | null;
  torch: boolean;
  pointsOfInterest: boolean;
  brightness: NumericRange | null;
  contrast: NumericRange | null;
  saturation: NumericRange | null;
  sharpness: NumericRange | null;
  photo: PhotoCapabilitiesInfo | null;
}

/** Settings as reported by getSettings(), restricted to the fields we use. */
export interface CameraSettings {
  deviceId?: string;
  facingMode?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  exposureMode?: string;
  exposureCompensation?: number;
  exposureTime?: number;
  iso?: number;
  whiteBalanceMode?: string;
  colorTemperature?: number;
  focusMode?: string;
  focusDistance?: number;
  zoom?: number;
  torch?: boolean;
  pointsOfInterest?: { x: number; y: number }[];
}

export function emptyCapabilities(): CameraCapabilities {
  return {
    deviceId: null,
    facingMode: [],
    width: null,
    height: null,
    frameRate: null,
    exposureMode: [],
    exposureCompensation: null,
    exposureTime: null,
    iso: null,
    whiteBalanceMode: [],
    colorTemperature: null,
    focusMode: [],
    focusDistance: null,
    zoom: null,
    torch: false,
    pointsOfInterest: false,
    brightness: null,
    contrast: null,
    saturation: null,
    sharpness: null,
    photo: null,
  };
}

/** Parse a `{min,max,step}` object; returns null unless it is a usable, finite, non-degenerate range. */
export function toRange(value: unknown): NumericRange | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const min = Number(v.min);
  const max = Number(v.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  const stepRaw = Number(v.step);
  const step = Number.isFinite(stepRaw) && stepRaw > 0 ? stepRaw : 0;
  return { min, max, step };
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === "string");
  if (typeof value === "string") return [value];
  return [];
}

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.includes(true);
  return false;
}

/**
 * Build CameraCapabilities from raw getCapabilities()/getSettings()/getPhotoCapabilities() output.
 * Pure — unit-testable with plain objects.
 */
export function normalizeCapabilities(
  trackCaps: Record<string, unknown> | null | undefined,
  settings: Record<string, unknown> | null | undefined,
  photoCaps?: Record<string, unknown> | null,
): CameraCapabilities {
  const c = trackCaps ?? {};
  const s = settings ?? {};
  const caps: CameraCapabilities = {
    ...emptyCapabilities(),
    deviceId: typeof c.deviceId === "string" ? c.deviceId : typeof s.deviceId === "string" ? s.deviceId : null,
    facingMode: toStringList(c.facingMode),
    width: toRange(c.width),
    height: toRange(c.height),
    frameRate: toRange(c.frameRate),
    exposureMode: toStringList(c.exposureMode),
    exposureCompensation: toRange(c.exposureCompensation),
    exposureTime: toRange(c.exposureTime),
    iso: toRange(c.iso),
    whiteBalanceMode: toStringList(c.whiteBalanceMode),
    colorTemperature: toRange(c.colorTemperature),
    focusMode: toStringList(c.focusMode),
    focusDistance: toRange(c.focusDistance),
    zoom: toRange(c.zoom),
    torch: toBool(c.torch),
    // Chrome does not list pointsOfInterest in getCapabilities(); it exposes it in getSettings() when supported.
    pointsOfInterest: "pointsOfInterest" in c || Array.isArray(s.pointsOfInterest),
    brightness: toRange(c.brightness),
    contrast: toRange(c.contrast),
    saturation: toRange(c.saturation),
    sharpness: toRange(c.sharpness),
  };
  if (photoCaps) {
    caps.photo = {
      imageWidth: toRange(photoCaps.imageWidth),
      imageHeight: toRange(photoCaps.imageHeight),
      fillLightMode: toStringList(photoCaps.fillLightMode),
      redEyeReduction: photoCaps.redEyeReduction === "controllable",
    };
  }
  return caps;
}

export function pickSettings(raw: Record<string, unknown> | null | undefined): CameraSettings {
  const s = raw ?? {};
  const out: CameraSettings = {};
  const num = (k: keyof CameraSettings) => {
    const v = s[k];
    if (typeof v === "number" && Number.isFinite(v)) (out as Record<string, unknown>)[k] = v;
  };
  const str = (k: keyof CameraSettings) => {
    const v = s[k];
    if (typeof v === "string") (out as Record<string, unknown>)[k] = v;
  };
  (
    ["width", "height", "frameRate", "exposureCompensation", "exposureTime", "iso", "colorTemperature"] as const
  ).forEach(num);
  (["focusDistance", "zoom"] as const).forEach(num);
  (["deviceId", "facingMode", "exposureMode", "whiteBalanceMode", "focusMode"] as const).forEach(str);
  if (typeof s.torch === "boolean") out.torch = s.torch;
  if (Array.isArray(s.pointsOfInterest)) out.pointsOfInterest = s.pointsOfInterest as { x: number; y: number }[];
  return out;
}

// ---- supported(x) helpers -------------------------------------------------

export const supportsRange = (r: NumericRange | null | undefined): r is NumericRange => !!r && r.max > r.min;

export const supportsManualExposure = (c: CameraCapabilities): boolean =>
  c.exposureMode.includes("manual") && (supportsRange(c.exposureTime) || supportsRange(c.iso));

export const supportsISO = (c: CameraCapabilities): boolean =>
  c.exposureMode.includes("manual") && supportsRange(c.iso);

export const supportsShutter = (c: CameraCapabilities): boolean =>
  c.exposureMode.includes("manual") && supportsRange(c.exposureTime);

export const supportsExposureCompensation = (c: CameraCapabilities): boolean => supportsRange(c.exposureCompensation);

export const supportsKelvin = (c: CameraCapabilities): boolean =>
  c.whiteBalanceMode.includes("manual") && supportsRange(c.colorTemperature);

export const supportsManualFocus = (c: CameraCapabilities): boolean =>
  c.focusMode.includes("manual") && supportsRange(c.focusDistance);

export const supportsZoom = (c: CameraCapabilities): boolean => supportsRange(c.zoom);

export const supportsTorch = (c: CameraCapabilities): boolean => c.torch;

export const supportsFlash = (c: CameraCapabilities): boolean =>
  !!c.photo && c.photo.fillLightMode.some((m) => m === "flash" || m === "auto");

/** HDR bracketing needs a real way to change exposure between frames. */
export const supportsBracketing = (c: CameraCapabilities): boolean =>
  supportsExposureCompensation(c) || supportsShutter(c);

export interface CapabilityRow {
  key: string;
  label: string;
  supported: boolean;
  detail: string;
}

const fmtRange = (r: NumericRange | null, unit = "") =>
  r ? `${round(r.min)}–${round(r.max)}${unit}${r.step ? ` (step ${round(r.step)})` : ""}` : "";

const round = (n: number) => (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100);

/** Human-readable capability table for the CapabilityList component. */
export function describeCapabilities(c: CameraCapabilities, imageCaptureAvailable: boolean): CapabilityRow[] {
  const exposureTimeRange = c.exposureTime
    ? `${formatTrackExposureTime(c.exposureTime.min)} – ${formatTrackExposureTime(c.exposureTime.max)}`
    : "";
  return [
    {
      key: "resolution",
      label: "Stream resolution",
      supported: !!(c.width && c.height),
      detail: c.width && c.height ? `up to ${c.width.max} × ${c.height.max}` : "",
    },
    {
      key: "photo",
      label: "Full-resolution photo (ImageCapture)",
      supported: imageCaptureAvailable && !!c.photo,
      detail:
        c.photo?.imageWidth && c.photo.imageHeight
          ? `up to ${c.photo.imageWidth.max} × ${c.photo.imageHeight.max}`
          : "",
    },
    { key: "iso", label: "ISO", supported: supportsISO(c), detail: fmtRange(c.iso) },
    {
      key: "shutter",
      label: "Shutter speed (exposure time)",
      supported: supportsShutter(c),
      detail: exposureTimeRange,
    },
    {
      key: "ev",
      label: "Exposure compensation",
      supported: supportsExposureCompensation(c),
      detail: fmtRange(c.exposureCompensation, " EV"),
    },
    {
      key: "exposureMode",
      label: "Exposure modes",
      supported: c.exposureMode.length > 0,
      detail: c.exposureMode.join(", "),
    },
    {
      key: "wb",
      label: "White balance (Kelvin)",
      supported: supportsKelvin(c),
      detail: fmtRange(c.colorTemperature, " K"),
    },
    {
      key: "wbMode",
      label: "White balance modes",
      supported: c.whiteBalanceMode.length > 0,
      detail: c.whiteBalanceMode.join(", "),
    },
    { key: "focusMode", label: "Focus modes", supported: c.focusMode.length > 0, detail: c.focusMode.join(", ") },
    {
      key: "focusDistance",
      label: "Manual focus distance",
      supported: supportsManualFocus(c),
      detail: fmtRange(c.focusDistance),
    },
    { key: "poi", label: "Tap-to-focus / metering point", supported: c.pointsOfInterest, detail: "" },
    { key: "zoom", label: "Zoom (device)", supported: supportsZoom(c), detail: fmtRange(c.zoom, "×") },
    { key: "torch", label: "Torch", supported: c.torch, detail: "" },
    { key: "flash", label: "Flash", supported: supportsFlash(c), detail: c.photo?.fillLightMode.join(", ") ?? "" },
    { key: "redEye", label: "Red-eye reduction", supported: !!c.photo?.redEyeReduction, detail: "" },
    {
      key: "aperture",
      label: "Aperture",
      supported: false,
      detail: "Not controllable from the browser (no web API exists)",
    },
  ];
}
