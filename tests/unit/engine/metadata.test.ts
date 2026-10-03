import { describe, expect, it } from "vitest";
import { readJpegSegments, sanitizeExifSegment, transplantJpegMetadata } from "@/lib/imageMetadata";

/** Build a little-endian EXIF APP1 with Orientation=6, a GPS IFD pointer and an IFD1 link. */
function makeExifApp1(): Uint8Array {
  const tiff = new Uint8Array(200);
  const v = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00]);
  v.setUint32(4, 8, true);
  v.setUint16(8, 2, true); // 2 entries
  // Orientation (0x0112) SHORT 1 value = 6
  v.setUint16(10, 0x0112, true);
  v.setUint16(12, 3, true);
  v.setUint32(14, 1, true);
  v.setUint16(18, 6, true);
  // GPS IFD pointer (0x8825) LONG → 100
  v.setUint16(22, 0x8825, true);
  v.setUint16(24, 4, true);
  v.setUint32(26, 1, true);
  v.setUint32(30, 100, true);
  v.setUint32(34, 150, true); // next IFD (thumbnail) offset
  // GPS IFD at 100 with one entry (GPSLatitudeRef 'N')
  v.setUint16(100, 1, true);
  v.setUint16(102, 0x0001, true);
  v.setUint16(104, 2, true);
  v.setUint32(106, 2, true);
  tiff[110] = 0x4e;
  const body = new Uint8Array(6 + tiff.length);
  body.set([0x45, 0x78, 0x69, 0x66, 0, 0]);
  body.set(tiff, 6);
  const seg = new Uint8Array(4 + body.length);
  seg.set([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff]);
  seg.set(body, 4);
  return seg;
}

const SOI = [0xff, 0xd8];
const SOS = [0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9];

describe("EXIF sanitising", () => {
  it("resets orientation, removes GPS entries and drops the thumbnail IFD", () => {
    const seg = makeExifApp1();
    const out = sanitizeExifSegment(seg, { stripGps: true });
    const v = new DataView(out.buffer, out.byteOffset + 10);
    expect(v.getUint16(18, true)).toBe(1);
    expect(v.getUint16(100, true)).toBe(0);
    expect(out[10 + 110]).toBe(0);
    expect(v.getUint32(34, true)).toBe(0);
  });
  it("keeps GPS when not asked to strip", () => {
    const out = sanitizeExifSegment(makeExifApp1(), { stripGps: false });
    expect(new DataView(out.buffer, out.byteOffset + 10).getUint16(100, true)).toBe(1);
  });
  it("transplants EXIF into an encoded JPEG", () => {
    const exif = makeExifApp1();
    const original = new Uint8Array([...SOI, ...exif, ...SOS]);
    const app0 = [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46];
    const encoded = new Uint8Array([...SOI, ...app0, ...SOS]);
    const merged = transplantJpegMetadata(original, encoded, { exif: true, icc: false, stripGps: true });
    const segs = readJpegSegments(merged)!;
    expect(segs.segments.map((s) => s.marker)).toEqual([0xe0, 0xe1]);
    expect(merged.subarray(merged.length - SOS.length)).toEqual(new Uint8Array(SOS));
  });
});
