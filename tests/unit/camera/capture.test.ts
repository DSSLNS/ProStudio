import { describe, expect, it } from "vitest";
import { aspectCropRect, captureFileName } from "@/camera/capture";
import { buildCaptureRecipe, composeCrop, digitalZoomCrop } from "@/camera/captureRecipe";
import {
  normalizeCapabilities,
  supportsISO,
  supportsKelvin,
  supportsBracketing,
  describeCapabilities,
} from "@/camera/capabilities";
import { verifyApplied } from "@/camera/autoCamera";
import { alignFrames, exposureFusion, stackFrames, estimateShift, downsampleLuma } from "@/camera/multiFrame";
import { makeFrame, rng } from "./helpers";

describe("aspect crop (non-destructive)", () => {
  it("returns null for full frame or matching ratio", () => {
    expect(aspectCropRect(4000, 3000, "full")).toBeNull();
    expect(aspectCropRect(4000, 3000, "4:3")).toBeNull();
  });
  it("crops 4:3 landscape to 16:9 vertically", () => {
    const c = aspectCropRect(4000, 3000, "16:9")!;
    expect(c.width).toBe(1);
    expect(c.height).toBeCloseTo(0.75);
    expect(c.y).toBeCloseTo(0.125);
  });
  it("uses the image orientation for portrait images", () => {
    const c = aspectCropRect(3000, 4000, "16:9")!;
    expect((c.width * 3000) / (c.height * 4000)).toBeCloseTo(9 / 16);
  });
  it("square crop", () => {
    const c = aspectCropRect(4000, 3000, "1:1")!;
    expect(c.width * 4000).toBeCloseTo(c.height * 3000);
  });
});

describe("capture recipe", () => {
  it("combines digital zoom and aspect crop and mirroring", () => {
    expect(digitalZoomCrop(1)).toBeNull();
    const z = digitalZoomCrop(2)!;
    expect(z).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    expect(composeCrop(z, { x: 0, y: 0.5, width: 1, height: 0.5 })).toEqual({
      x: 0.25,
      y: 0.5,
      width: 0.5,
      height: 0.25,
    });
    const r = buildCaptureRecipe({ width: 4000, height: 3000, aspect: "1:1", digitalZoom: 1, mirror: true });
    expect(r.geometry.flipH).toBe(true);
    expect(r.geometry.crop!.height).toBe(1);
    expect(r.geometry.crop!.width).toBeCloseTo(0.75);
  });
  it("leaves the recipe at defaults when nothing is chosen", () => {
    const r = buildCaptureRecipe({ width: 1920, height: 1080, aspect: "full", digitalZoom: 1, mirror: false });
    expect(r.geometry.crop).toBeNull();
    expect(r.light.exposure).toBe(0);
  });
  it("file names are timestamped", () => {
    expect(captureFileName(new Date(2026, 0, 2, 3, 4, 5))).toBe("PS_20260102_030405.jpg");
  });
});

describe("capabilities", () => {
  it("normalizes reported capabilities and ignores degenerate ranges", () => {
    const c = normalizeCapabilities(
      {
        width: { min: 1, max: 1920 },
        height: { min: 1, max: 1080 },
        iso: { min: 100, max: 100, step: 1 },
        exposureMode: ["continuous", "manual"],
        exposureTime: { min: 1, max: 10000, step: 1 },
        whiteBalanceMode: ["continuous", "manual"],
        colorTemperature: { min: 2850, max: 6500, step: 50 },
        torch: true,
      },
      { pointsOfInterest: [{ x: 0.5, y: 0.5 }] },
      {
        fillLightMode: ["auto", "off", "flash"],
        imageWidth: { min: 640, max: 4032, step: 1 },
        imageHeight: { min: 480, max: 3024, step: 1 },
      },
    );
    expect(c.iso).toBeNull();
    expect(supportsISO(c)).toBe(false);
    expect(supportsKelvin(c)).toBe(true);
    expect(supportsBracketing(c)).toBe(true);
    expect(c.pointsOfInterest).toBe(true);
    expect(c.torch).toBe(true);
    expect(c.photo?.imageWidth?.max).toBe(4032);
  });
  it("aperture is always reported as unavailable", () => {
    const rows = describeCapabilities(normalizeCapabilities({}, {}), false);
    const ap = rows.find((r) => r.key === "aperture")!;
    expect(ap.supported).toBe(false);
    expect(ap.detail).toMatch(/browser/);
    expect(rows.every((r) => r.supported === false)).toBe(true);
  });
  it("verifyApplied keeps only values the camera confirms", () => {
    expect(
      verifyApplied(
        { iso: 400, exposureTime: 40, focusMode: "manual" },
        { iso: 400, exposureTime: 80, focusMode: "manual" },
      ),
    ).toEqual({
      iso: 400,
      focusMode: "manual",
    });
    expect(verifyApplied({ torch: true }, {})).toEqual({});
  });
});

describe("multi-frame", () => {
  const W = 64;
  const H = 48;
  const r = rng(3);
  const scene = Array.from({ length: W * H }, () => r() * 255);
  const shifted = (dx: number, dy: number, noise: () => number) =>
    makeFrame(W, H, (x, y) => {
      const sx = Math.min(W - 1, Math.max(0, x + dx));
      const sy = Math.min(H - 1, Math.max(0, y + dy));
      const v = scene[sy * W + sx] + noise();
      return [v, v, v];
    });

  it("estimates translational shifts", () => {
    const a = downsampleLuma({ data: shifted(0, 0, () => 0), width: W, height: H }, 1);
    const b = downsampleLuma({ data: shifted(-3, 2, () => 0), width: W, height: H }, 1);
    expect(estimateShift(a.luma, b.luma, W, H, 5)).toEqual({ dx: 3, dy: -2 });
  });

  it("aligns and averages, reducing noise", () => {
    const n = rng(9);
    const noise = () => (n() - 0.5) * 60;
    const frames = [shifted(0, 0, noise), shifted(-2, 1, noise), shifted(1, -1, noise), shifted(0, 2, noise)].map(
      (data) => ({ data, width: W, height: H }),
    );
    const shifts = alignFrames(frames, 8);
    expect(shifts[1]).toEqual({ dx: 2, dy: -1 });
    const out = stackFrames(frames, shifts);
    const err = (d: Uint8ClampedArray) => {
      let s = 0;
      let c = 0;
      for (let y = 4; y < H - 4; y++)
        for (let x = 4; x < W - 4; x++) {
          const v = scene[y * W + x];
          if (v < 40 || v > 215) continue; // ignore clipped values
          s += Math.abs(d[(y * W + x) * 4] - v);
          c++;
        }
      return s / c;
    };
    expect(err(out.data)).toBeLessThan(err(frames[0].data) * 0.7);
  });

  it("exposure fusion favours well-exposed pixels", () => {
    const dark = { data: makeFrame(2, 1, () => [10, 10, 10]), width: 2, height: 1 };
    const mid = { data: makeFrame(2, 1, () => [128, 128, 128]), width: 2, height: 1 };
    const bright = { data: makeFrame(2, 1, () => [250, 250, 250]), width: 2, height: 1 };
    const out = exposureFusion([dark, mid, bright]);
    expect(Math.abs(out.data[0] - 128)).toBeLessThan(15);
  });
});
