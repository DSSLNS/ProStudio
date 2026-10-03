/**
 * Focus helpers: mapping taps to normalized points of interest, describing the
 * available focus modes, and a contrast-based focus confirmation measure.
 */

import type { CameraCapabilities } from "./capabilities";
import { supportsManualFocus } from "./capabilities";

export type FocusChoice = "auto" | "continuous" | "single" | "manual" | "locked";

export interface FocusOption {
  value: FocusChoice;
  label: string;
  available: boolean;
  /** The focusMode string sent to the track. */
  trackMode: string | null;
}

/** Focus options with honest availability, derived from the reported focusMode list. */
export function focusOptions(c: CameraCapabilities): FocusOption[] {
  const has = (m: string) => c.focusMode.includes(m);
  return [
    { value: "continuous", label: "Continuous AF", available: has("continuous"), trackMode: "continuous" },
    { value: "single", label: "Single AF", available: has("single-shot"), trackMode: "single-shot" },
    { value: "manual", label: "Manual", available: supportsManualFocus(c), trackMode: "manual" },
    // Lock = switch to manual at the current distance (keeps the reported focusDistance).
    {
      value: "locked",
      label: "Focus lock",
      available: has("manual") || has("none"),
      trackMode: has("manual") ? "manual" : "none",
    },
  ];
}

/**
 * Map a pointer position on the displayed preview to a normalized point
 * (0..1) in the *sensor* frame. The preview element shows the full frame
 * (no cropping), so this is a direct ratio; mirroring flips x back.
 */
export function tapToPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  mirrored: boolean,
): { x: number; y: number } {
  let x = (clientX - rect.left) / Math.max(1, rect.width);
  const y = (clientY - rect.top) / Math.max(1, rect.height);
  if (mirrored) x = 1 - x;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

/** True if getSettings() reports a point of interest close to the requested one. */
export function pointConfirmed(
  requested: { x: number; y: number },
  reported: { x: number; y: number }[] | undefined,
): boolean {
  if (!reported || reported.length === 0) return false;
  return reported.some((p) => Math.abs(p.x - requested.x) < 0.05 && Math.abs(p.y - requested.y) < 0.05);
}

/**
 * Relative focus quality 0..1 from a Laplacian variance measure. Log-scaled
 * because variance spans orders of magnitude between blurred and sharp frames.
 */
export function focusQuality(laplacianVar: number): number {
  return Math.max(0, Math.min(1, Math.log10(1 + laplacianVar) / 3.2));
}

/**
 * focusDistance units are device-defined in practice (the spec says metres;
 * some Android devices report diopters), so we display the raw value with a
 * neutral label rather than inventing a unit.
 */
export function formatFocusDistance(v: number): string {
  return Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2);
}
