/**
 * White balance: hardware Kelvin presets (only when the device reports a
 * colorTemperature range with whiteBalanceMode "manual") and software
 * corrections expressed as non-destructive EditRecipe temperature/tint values.
 *
 * Recipe convention: color.temperature −100..100, positive = warmer;
 * color.tint −100..100, positive = more magenta (Lightroom convention).
 */

import type { NumericRange } from "./capabilities";
import { snapToRange } from "./exposure";
import { kelvinToTemperatureSlider } from "@/engine/color/math";

export interface WbPreset {
  id: "daylight" | "cloudy" | "shade" | "tungsten" | "fluorescent" | "led";
  label: string;
  kelvin: number;
}

export const WB_PRESETS: WbPreset[] = [
  { id: "daylight", label: "Daylight", kelvin: 5500 },
  { id: "cloudy", label: "Cloudy", kelvin: 6500 },
  { id: "shade", label: "Shade", kelvin: 7500 },
  { id: "tungsten", label: "Tungsten", kelvin: 3200 },
  { id: "fluorescent", label: "Fluorescent", kelvin: 4000 },
  { id: "led", label: "LED", kelvin: 4500 },
];

/** Presets the device can actually apply (Kelvin inside its colorTemperature range). */
export function presetsInRange(range: NumericRange | null): WbPreset[] {
  if (!range) return [];
  return WB_PRESETS.filter((p) => p.kelvin >= range.min && p.kelvin <= range.max);
}

/** Clamp/snap a Kelvin value to the device range. */
export const kelvinForDevice = (kelvin: number, range: NumericRange): number => snapToRange(kelvin, range);

/** Reference white the editor's Temperature slider is balanced for (see engine/color/math.ts). */
export const NEUTRAL_KELVIN = 6500;

/**
 * Software correction (recipe temperature, −100..100) that neutralises an
 * illuminant of `lightKelvin`, using the editor's own mapping
 * (kelvinToTemperatureSlider). A warm (low-K) light renders the image orange,
 * so the correction is negative (cooler): tungsten 3200 K → about −93.
 */
export function softwareTemperatureFor(lightKelvin: number): number {
  const v = Math.round(kelvinToTemperatureSlider(lightKelvin));
  return Object.is(v, -0) ? 0 : v;
}

/** Software tint correction from a gray-world tint estimate (+ = green cast → add magenta). */
export function softwareTintFor(greenCast: number): number {
  const v = Math.round(Math.max(-100, Math.min(100, greenCast * 150)));
  return Object.is(v, -0) ? 0 : v;
}

export interface WbRecommendation {
  /** Estimated illuminant temperature (gray-world). */
  estimatedKelvin: number;
  /** Kelvin to request from hardware (snapped), or null when not supported. */
  hardwareKelvin: number | null;
  /** Non-destructive software correction values (only meaningful if hardware WB is not used). */
  softwareTemperature: number;
  softwareTint: number;
  /** True when the cast is small enough that no correction is advisable. */
  neutral: boolean;
}

/**
 * Recommend WB from a gray-world estimate. Correction strength is halved
 * because gray-world over-corrects scenes that are legitimately colourful
 * (sunsets, foliage); results are suggestions, never baked into pixels.
 */
export function recommendWhiteBalance(
  estimate: { cct: number; tint: number },
  colorTemperatureRange: NumericRange | null,
): WbRecommendation {
  const hardwareKelvin = colorTemperatureRange ? kelvinForDevice(estimate.cct, colorTemperatureRange) : null;
  const softwareTemperature = Math.round(softwareTemperatureFor(estimate.cct) * 0.5);
  const softwareTint = Math.round(softwareTintFor(estimate.tint) * 0.5);
  const neutral = Math.abs(softwareTemperature) < 4 && Math.abs(softwareTint) < 4;
  return {
    estimatedKelvin: estimate.cct,
    hardwareKelvin,
    softwareTemperature: neutral || Object.is(softwareTemperature, -0) ? 0 : softwareTemperature,
    softwareTint: neutral || Object.is(softwareTint, -0) ? 0 : softwareTint,
    neutral,
  };
}

export function describeKelvin(k: number): string {
  if (k < 3500) return "warm (tungsten-like)";
  if (k < 4800) return "warm-neutral (indoor/LED)";
  if (k < 6200) return "neutral (daylight)";
  if (k < 7200) return "cool (overcast)";
  return "very cool (shade/blue hour)";
}
