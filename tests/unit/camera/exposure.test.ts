import { describe, expect, it } from "vitest";
import {
  buildManualExposureSet,
  calculateExposure,
  evOffsetFromLinear,
  formatEv,
  formatShutter,
  formatTrackExposureTime,
  isosInRange,
  recommendIsoShutter,
  secondsToTrackUnits,
  shutterStopsInRange,
  snapToRange,
  trackUnitsToSeconds,
} from "@/camera/exposure";

describe("exposureTime unit conversion (100 µs units)", () => {
  it("converts seconds ↔ track units", () => {
    expect(secondsToTrackUnits(1 / 250)).toBeCloseTo(40);
    expect(secondsToTrackUnits(1)).toBeCloseTo(10000);
    expect(trackUnitsToSeconds(40)).toBeCloseTo(0.004);
    expect(trackUnitsToSeconds(secondsToTrackUnits(1 / 60))).toBeCloseTo(1 / 60);
  });
  it("formats track units as shutter speeds", () => {
    expect(formatTrackExposureTime(40)).toBe("1/250");
    expect(formatTrackExposureTime(10000)).toBe("1s");
    expect(formatTrackExposureTime(333)).toBe("1/30");
  });
});

describe("formatShutter", () => {
  it.each([
    [1 / 1000, "1/1000"],
    [1 / 250, "1/250"],
    [1 / 125, "1/125"],
    [1 / 60, "1/60"],
    [1 / 8, "1/8"],
    [0.5, "1/2"],
    [1, "1s"],
    [2.5, "2.5s"],
    [1 / 12, "1/12"],
  ])("%f → %s", (s, label) => expect(formatShutter(s)).toBe(label));
  it("handles invalid input", () => expect(formatShutter(0)).toBe("—"));
});

describe("ranges", () => {
  it("filters standard stops to the device range", () => {
    // 1/500 s (20 units) … 1/15 s (667 units)
    const stops = shutterStopsInRange({ min: 20, max: 667, step: 1 });
    expect(stops.map(formatShutter)).toEqual(["1/500", "1/250", "1/125", "1/60", "1/30", "1/15"]);
    expect(shutterStopsInRange(null)).toEqual([]);
  });
  it("filters ISO stops", () => {
    expect(isosInRange({ min: 100, max: 1600, step: 1 })).toEqual([100, 200, 400, 800, 1600]);
  });
  it("snaps to step and clamps", () => {
    expect(snapToRange(0.47, { min: -2, max: 2, step: 1 / 3 })).toBeCloseTo(1 / 3, 5);
    expect(snapToRange(9, { min: -2, max: 2, step: 0.5 })).toBe(2);
    expect(snapToRange(123.4, { min: 50, max: 3200, step: 0 })).toBe(123.4);
  });
});

describe("metering", () => {
  it("middle grey is 0 EV, one stop brighter is +1", () => {
    expect(evOffsetFromLinear(0.18)).toBeCloseTo(0);
    expect(evOffsetFromLinear(0.36)).toBeCloseTo(1);
  });
  it("brightens an under-exposed scene", () => {
    const r = calculateExposure({ meteredLinear: 0.045, highlightClip: 0, shadowClip: 0 });
    expect(r.ev).toBeCloseTo(2, 1);
    expect(r.meteredOn).toBe("center-weighted");
  });
  it("does not brighten when highlights clip (highlight protection)", () => {
    const r = calculateExposure({ meteredLinear: 0.05, highlightClip: 0.04, shadowClip: 0 });
    expect(r.ev).toBeLessThanOrEqual(0);
    expect(r.highlightProtected).toBe(true);
  });
  it("pulls exposure down when heavily clipping", () => {
    const r = calculateExposure({ meteredLinear: 0.18, highlightClip: 0.12, shadowClip: 0 });
    expect(r.ev).toBeLessThan(-0.5);
  });
  it("avoids crushing shadows", () => {
    const r = calculateExposure({ meteredLinear: 0.5, highlightClip: 0, shadowClip: 0.35 });
    expect(r.ev).toBe(0);
    expect(r.shadowProtected).toBe(true);
  });
  it("prefers faces when detected", () => {
    const r = calculateExposure({ meteredLinear: 0.4, highlightClip: 0, shadowClip: 0, faceLinear: 0.0636 });
    expect(r.meteredOn).toBe("faces");
    expect(r.ev).toBeGreaterThan(1.5);
  });
  it("clamps to ±3 EV", () => {
    expect(calculateExposure({ meteredLinear: 0.0001, highlightClip: 0, shadowClip: 0 }).ev).toBe(3);
  });
  it("formats EV", () => {
    expect(formatEv(0.02)).toBe("0 EV");
    expect(formatEv(0.7)).toBe("+0.7 EV");
    expect(formatEv(-1)).toBe("−1.0 EV");
  });
});

describe("ISO/shutter recommendation", () => {
  const isoRange = { min: 50, max: 3200, step: 1 };
  const exposureTimeRange = { min: 1, max: 10000, step: 1 };
  it("returns null without current values (never invents numbers)", () => {
    expect(
      recommendIsoShutter({
        evCorrection: 1,
        currentIso: undefined,
        currentExposureSeconds: 0.01,
        isoRange,
        exposureTimeRange,
        moving: false,
      }),
    ).toBeNull();
  });
  it("keeps total exposure equal to the requested EV", () => {
    const r = recommendIsoShutter({
      evCorrection: 1,
      currentIso: 100,
      currentExposureSeconds: 1 / 100,
      isoRange,
      exposureTimeRange,
      moving: false,
    })!;
    expect(r.iso * r.exposureSeconds).toBeCloseTo(100 * (1 / 100) * 2, 2);
    expect(r.residualEv).toBe(0);
  });
  it("uses a fast shutter for moving subjects", () => {
    const r = recommendIsoShutter({
      evCorrection: 0,
      currentIso: 100,
      currentExposureSeconds: 1 / 30,
      isoRange,
      exposureTimeRange,
      moving: true,
    })!;
    expect(r.exposureSeconds).toBeLessThanOrEqual(1 / 250 + 1e-9);
    expect(r.iso).toBeGreaterThan(100);
  });
  it("reports residual EV when ranges are exhausted", () => {
    const r = recommendIsoShutter({
      evCorrection: 6,
      currentIso: 3200,
      currentExposureSeconds: 1 / 15,
      isoRange,
      exposureTimeRange,
      moving: false,
    })!;
    expect(r.residualEv).toBeGreaterThan(0);
  });
});

describe("buildManualExposureSet", () => {
  const base = {
    currentIso: 200,
    currentExposureTime: 100,
    isoRange: { min: 100, max: 1600, step: 1 },
    exposureTimeRange: { min: 10, max: 5000, step: 1 },
    exposureModes: ["manual", "continuous"],
  };
  it("returns continuous when both are auto", () => {
    expect(buildManualExposureSet({ ...base, iso: null, shutterSeconds: null })).toEqual({
      exposureMode: "continuous",
    });
  });
  it("includes both ISO and exposureTime in manual mode", () => {
    expect(buildManualExposureSet({ ...base, iso: 400, shutterSeconds: null })).toEqual({
      exposureMode: "manual",
      iso: 400,
      exposureTime: 100,
    });
    expect(buildManualExposureSet({ ...base, iso: null, shutterSeconds: 1 / 250 })).toEqual({
      exposureMode: "manual",
      iso: 200,
      exposureTime: 40,
    });
  });
  it("returns null when manual exposure is unsupported", () => {
    expect(
      buildManualExposureSet({ ...base, exposureModes: ["continuous"], iso: 400, shutterSeconds: null }),
    ).toBeNull();
  });
});
