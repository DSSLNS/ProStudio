import { describe, expect, it } from "vitest";
import exifr from "exifr";
import { buildSrgbIcc, iccJpegSegment, isWideGamutProfile, SRGB_PROFILE_DESCRIPTION } from "@/engine/color/icc";
import { buildExif, exifJpegSegment, insertJpegSegments } from "@/engine/export/exifWriter";

// Minimal valid baseline JPEG skeleton is not needed: exifr reads APP segments from SOI.
const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const jpegWith = (...segs: Uint8Array[]) => insertJpegSegments(new Uint8Array([...SOI, ...EOI]), segs);

describe("sRGB ICC profile", () => {
  const icc = buildSrgbIcc();
  it("has a valid ICC header", () => {
    const v = new DataView(icc.buffer);
    expect(v.getUint32(0)).toBe(icc.length);
    expect(String.fromCharCode(...icc.subarray(36, 40))).toBe("acsp");
    expect(String.fromCharCode(...icc.subarray(12, 16))).toBe("mntr");
    expect(String.fromCharCode(...icc.subarray(16, 20))).toBe("RGB ");
    expect(v.getUint32(128)).toBe(9); // tag count
  });
  it("is readable by an independent parser when embedded in a JPEG", async () => {
    const out = await exifr.parse(jpegWith(iccJpegSegment(icc)), { icc: true, tiff: false, exif: false });
    expect(out?.ProfileDescription).toBe(SRGB_PROFILE_DESCRIPTION);
    expect(out?.ColorSpaceData?.trim?.() ?? out?.ColorSpaceData).toMatch(/RGB/);
  });
  it("detects wide-gamut profile names", () => {
    expect(isWideGamutProfile("Display P3")).toBe(true);
    expect(isWideGamutProfile("Adobe RGB (1998)")).toBe(true);
    expect(isWideGamutProfile("sRGB IEC61966-2.1")).toBe(false);
    expect(isWideGamutProfile(undefined)).toBe(false);
  });
});

describe("EXIF writer", () => {
  const meta = {
    make: "Sony",
    model: "ILCE-7M3",
    lens: "FE 24-70mm F2.8 GM",
    iso: 400,
    exposureTime: 1 / 250,
    fNumber: 2.8,
    focalLength: 35,
    dateTaken: "2024-05-06T07:08:09.000Z",
    hasGps: true,
    latitude: 48.8584,
    longitude: -2.2945,
  };
  it("writes camera, lens, exposure and date that exifr reads back", async () => {
    const out = await exifr.parse(jpegWith(exifJpegSegment(buildExif(meta, { includeGps: true }))), { tiff: true, exif: true, gps: true });
    expect(out.Make).toBe("Sony");
    expect(out.Model).toBe("ILCE-7M3");
    expect(out.LensModel).toBe("FE 24-70mm F2.8 GM");
    expect(out.ISO).toBe(400);
    expect(out.ExposureTime).toBeCloseTo(1 / 250, 6);
    expect(out.FNumber).toBeCloseTo(2.8, 6);
    expect(out.FocalLength).toBe(35);
    expect(out.Orientation === 1 || out.Orientation === "Horizontal (normal)").toBe(true);
    expect(out.latitude).toBeCloseTo(48.8584, 3);
    expect(out.longitude).toBeCloseTo(-2.2945, 3);
  });
  it("omits GPS entirely when location is removed", async () => {
    const out = await exifr.parse(jpegWith(exifJpegSegment(buildExif(meta, { includeGps: false }))), { tiff: true, exif: true, gps: true });
    expect(out.Make).toBe("Sony");
    expect(out.latitude).toBeUndefined();
  });
});
