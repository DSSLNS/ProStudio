/**
 * Exposure maths: unit conversion for MediaTrackConstraints.exposureTime,
 * shutter formatting, metering → EV, and ISO/shutter recommendations.
 * Everything here is pure and unit-tested.
 */

import type { NumericRange } from "./capabilities";

/**
 * MediaTrackConstraints.exposureTime is expressed in units of 100 µs in Chrome
 * (the Image Capture spec text says "milliseconds", but Chromium's implementation
 * and every shipping device use 100 µs). 1/250 s = 4 ms = 40 units.
 */
export const EXPOSURE_TIME_UNIT_SECONDS = 1e-4;

export const secondsToTrackUnits = (seconds: number): number => seconds / EXPOSURE_TIME_UNIT_SECONDS;
export const trackUnitsToSeconds = (units: number): number => units * EXPOSURE_TIME_UNIT_SECONDS;

/** Standard full-stop shutter speeds, fastest → slowest, in seconds (1/1000 … 1 s). */
export const STANDARD_SHUTTER_STOPS: number[] = [
  1 / 1000,
  1 / 500,
  1 / 250,
  1 / 125,
  1 / 60,
  1 / 30,
  1 / 15,
  1 / 8,
  1 / 4,
  1 / 2,
  1,
];

/** Format an exposure time in seconds the way cameras do: 1/250, 1/8, 0.5″ → "1/2", 1 s → "1s", 2.5 s → "2.5s". */
export function formatShutter(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds >= 0.95) {
    const r = Math.round(seconds * 10) / 10;
    return `${Number.isInteger(r) ? r.toFixed(0) : r}s`;
  }
  const denom = 1 / seconds;
  // Snap to a nearby "nice" denominator so 1/0.004 → 250, 1/0.0333 → 30.
  const nice = denom >= 10 ? Math.round(denom / 5) * 5 || Math.round(denom) : Math.round(denom * 10) / 10;
  const close = Math.abs(nice - denom) / denom < 0.04 ? nice : Math.round(denom);
  return `1/${Number.isInteger(close) ? close : close.toFixed(1)}`;
}

/** Format a track exposureTime value (100 µs units) for display. */
export const formatTrackExposureTime = (units: number): string => formatShutter(trackUnitsToSeconds(units));

/** Standard stops that fall inside the device's exposureTime range (track units). */
export function shutterStopsInRange(range: NumericRange | null): number[] {
  if (!range) return [];
  const minS = trackUnitsToSeconds(range.min);
  const maxS = trackUnitsToSeconds(range.max);
  return STANDARD_SHUTTER_STOPS.filter((s) => s >= minS * 0.999 && s <= maxS * 1.001);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Clamp to a capability range and snap to its step (if any). */
export function snapToRange(value: number, range: NumericRange): number {
  const v = clamp(value, range.min, range.max);
  if (!range.step) return v;
  const snapped = range.min + Math.round((v - range.min) / range.step) * range.step;
  return clamp(Number(snapped.toFixed(6)), range.min, range.max);
}

/** Middle grey in linear light (18% reflectance). */
export const MIDDLE_GREY_LINEAR = 0.18;

/**
 * EV offset of a metered linear luminance from middle grey. +1 means one stop
 * brighter than 18% grey (over-exposed relative to the meter), −1 one stop darker.
 */
export function evOffsetFromLinear(linearLuma: number): number {
  return Math.log2(Math.max(linearLuma, 1e-5) / MIDDLE_GREY_LINEAR);
}

export interface ExposureInputs {
  /** Mean linear luminance 0..1 (center-weighted). */
  meteredLinear: number;
  /** Fraction of pixels at/near 255. */
  highlightClip: number;
  /** Fraction of pixels at/near 0. */
  shadowClip: number;
  /** Mean linear luminance of detected faces, when faces were found. */
  faceLinear?: number | null;
  /** Approximate scene key: night scenes should stay dark. */
  lowKey?: boolean;
}

export interface ExposureCalculation {
  /** EV correction to apply (positive = brighten). */
  ev: number;
  /** Which zone the meter was based on. */
  meteredOn: "faces" | "center-weighted";
  highlightProtected: boolean;
  shadowProtected: boolean;
  /** Current EV offset of the metered zone from middle grey. */
  currentOffset: number;
}

/**
 * Compute the exposure correction. Faces win when present (with a slight
 * brighter target for skin). Highlight protection limits brightening (and
 * pulls down) when highlights are clipping; shadow protection limits darkening
 * when shadows are crushed. Result clamped to ±3 EV and rounded to 1/10 EV.
 */
export function calculateExposure(input: ExposureInputs): ExposureCalculation {
  const useFaces = typeof input.faceLinear === "number" && input.faceLinear > 0;
  const metered = useFaces ? (input.faceLinear as number) : input.meteredLinear;
  // Skin is typically ~+0.5 EV over middle grey; night scenes are intentionally darker.
  const target = useFaces
    ? MIDDLE_GREY_LINEAR * Math.SQRT2
    : input.lowKey
      ? MIDDLE_GREY_LINEAR / 2
      : MIDDLE_GREY_LINEAR;
  const currentOffset = evOffsetFromLinear(metered);
  let ev = Math.log2(target / Math.max(metered, 1e-5));
  let highlightProtected = false;
  let shadowProtected = false;

  if (input.highlightClip > 0.01 && ev > 0) {
    // Already clipping: do not brighten more than a little.
    ev = Math.min(ev, input.highlightClip > 0.03 ? 0 : 0.3);
    highlightProtected = true;
  }
  if (input.highlightClip > 0.05 && !useFaces) {
    // Significant clipping: pull exposure down proportionally (max −1.5 EV).
    ev = Math.min(ev, -clamp((input.highlightClip - 0.05) * 15 + 0.3, 0.3, 1.5));
    highlightProtected = true;
  }
  if (input.shadowClip > 0.15 && ev < 0) {
    // Avoid crushing shadows further.
    ev = Math.max(ev, input.shadowClip > 0.3 ? 0 : -0.3);
    shadowProtected = true;
  }
  ev = Math.round(clamp(ev, -3, 3) * 10) / 10;
  return {
    ev: Object.is(ev, -0) ? 0 : ev,
    meteredOn: useFaces ? "faces" : "center-weighted",
    highlightProtected,
    shadowProtected,
    currentOffset,
  };
}

export interface IsoShutterRecommendation {
  iso: number;
  /** Seconds. */
  exposureSeconds: number;
  /** EV that could not be reached within the ranges (positive = still under-exposed). */
  residualEv: number;
  reason: string;
}

/**
 * Recommend an ISO/shutter pair for a required EV change, based on the
 * camera's *current* reported ISO and exposure time. Returns null when the
 * current values are unknown (we cannot compute absolute exposure from an
 * auto-exposed preview without them — we never invent numbers).
 */
export function recommendIsoShutter(params: {
  evCorrection: number;
  currentIso: number | undefined;
  currentExposureSeconds: number | undefined;
  isoRange: NumericRange | null;
  exposureTimeRange: NumericRange | null; // track units
  moving: boolean;
}): IsoShutterRecommendation | null {
  const { evCorrection, currentIso, currentExposureSeconds, isoRange, exposureTimeRange, moving } = params;
  if (!currentIso || !currentExposureSeconds || !isoRange || !exposureTimeRange) return null;
  const tMin = trackUnitsToSeconds(exposureTimeRange.min);
  const tMax = trackUnitsToSeconds(exposureTimeRange.max);
  // Exposure ∝ ISO × t. Target product:
  const product = currentIso * currentExposureSeconds * Math.pow(2, evCorrection);
  // Slowest acceptable handheld shutter; moving subjects need ≥1/250.
  const slowest = clamp(moving ? 1 / 250 : 1 / 30, tMin, tMax);
  let t = clamp(product / isoRange.min, tMin, slowest);
  let iso = clamp(product / t, isoRange.min, isoRange.max);
  if (iso >= isoRange.max) {
    // ISO ceiling reached — allow a slower shutter (up to 1/15 when static).
    const slowLimit = clamp(moving ? slowest : 1 / 15, tMin, tMax);
    t = clamp(product / iso, tMin, slowLimit);
  }
  iso = snapToRange(iso, isoRange);
  const tUnits = snapToRange(secondsToTrackUnits(t), exposureTimeRange);
  t = trackUnitsToSeconds(tUnits);
  const residualEv = Math.round(Math.log2(product / (iso * t)) * 10) / 10;
  const reason = moving
    ? "Fast shutter to freeze motion"
    : iso <= isoRange.min * 1.01
      ? "Lowest ISO for minimum noise"
      : "Raised ISO to keep a hand-holdable shutter";
  return { iso, exposureSeconds: t, residualEv: Object.is(residualEv, -0) ? 0 : residualEv, reason };
}

/** Convert an EV correction into a value valid for the exposureCompensation range. */
export function evToCompensation(ev: number, range: NumericRange): number {
  return snapToRange(ev, range);
}

/** Format an EV value: +0.7 EV, −1.0 EV, 0 EV. */
export function formatEv(ev: number): string {
  if (Math.abs(ev) < 0.05) return "0 EV";
  return `${ev > 0 ? "+" : "−"}${Math.abs(ev).toFixed(1)} EV`;
}

/** Standard ISO values offered in manual mode (filtered to the device range). */
export const STANDARD_ISOS = [50, 100, 200, 400, 800, 1600, 3200, 6400, 12800];

export function isosInRange(range: NumericRange | null): number[] {
  if (!range) return [];
  return STANDARD_ISOS.filter((v) => v >= range.min && v <= range.max);
}

/**
 * Constraint set for manual ISO/shutter intent. ISO and exposureTime only take
 * effect with exposureMode "manual", so a manual request always includes both:
 * the unspecified one keeps the camera's currently reported value. Both null →
 * back to continuous auto exposure. Returns null when the request cannot be expressed.
 */
export function buildManualExposureSet(params: {
  iso: number | null;
  shutterSeconds: number | null;
  currentIso: number | undefined;
  currentExposureTime: number | undefined; // track units
  isoRange: NumericRange | null;
  exposureTimeRange: NumericRange | null;
  exposureModes: string[];
}): { exposureMode: string; iso?: number; exposureTime?: number } | null {
  const { iso, shutterSeconds, isoRange, exposureTimeRange, exposureModes } = params;
  if (iso === null && shutterSeconds === null) {
    return exposureModes.includes("continuous") ? { exposureMode: "continuous" } : null;
  }
  if (!exposureModes.includes("manual")) return null;
  const out: { exposureMode: string; iso?: number; exposureTime?: number } = { exposureMode: "manual" };
  if (isoRange) {
    const v = iso ?? params.currentIso;
    if (typeof v === "number") out.iso = snapToRange(v, isoRange);
  }
  if (exposureTimeRange) {
    const t = shutterSeconds !== null ? secondsToTrackUnits(shutterSeconds) : params.currentExposureTime;
    if (typeof t === "number") out.exposureTime = snapToRange(t, exposureTimeRange);
  }
  if ((iso !== null && out.iso === undefined) || (shutterSeconds !== null && out.exposureTime === undefined))
    return null;
  return out;
}
