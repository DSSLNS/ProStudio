import { describe, expect, it } from "vitest";
import {
  presetsInRange,
  recommendWhiteBalance,
  softwareTemperatureFor,
  softwareTintFor,
  WB_PRESETS,
} from "@/camera/whiteBalance";

describe("white balance", () => {
  it("has the standard Kelvin presets", () => {
    expect(Object.fromEntries(WB_PRESETS.map((p) => [p.id, p.kelvin]))).toEqual({
      daylight: 5500,
      cloudy: 6500,
      shade: 7500,
      tungsten: 3200,
      fluorescent: 4000,
      led: 4500,
    });
  });
  it("offers only presets inside the device range", () => {
    expect(presetsInRange({ min: 2800, max: 5000, step: 50 }).map((p) => p.id)).toEqual([
      "tungsten",
      "fluorescent",
      "led",
    ]);
    expect(presetsInRange(null)).toEqual([]);
  });
  it("cools warm light and warms cool light (software correction)", () => {
    expect(softwareTemperatureFor(3200)).toBeLessThan(-50);
    expect(softwareTemperatureFor(6500)).toBe(0);
    expect(softwareTemperatureFor(10000)).toBeGreaterThan(0);
    expect(softwareTemperatureFor(1000)).toBeGreaterThanOrEqual(-100);
  });
  it("adds magenta to counter a green cast", () => {
    expect(softwareTintFor(0.1)).toBeGreaterThan(0);
    expect(softwareTintFor(0)).toBe(0);
  });
  it("recommends hardware Kelvin only when a range is given", () => {
    expect(recommendWhiteBalance({ cct: 3300, tint: 0 }, null).hardwareKelvin).toBeNull();
    expect(recommendWhiteBalance({ cct: 3333, tint: 0 }, { min: 2500, max: 7500, step: 100 }).hardwareKelvin).toBe(
      3300,
    );
  });
  it("treats near-neutral scenes as neutral", () => {
    const r = recommendWhiteBalance({ cct: 6400, tint: 0.005 }, null);
    expect(r.neutral).toBe(true);
    expect(r.softwareTemperature).toBe(0);
  });
});
