/**
 * Minimal EXIF (TIFF) writer used when the original has no EXIF block we can
 * copy (RAW, PNG, HEIC, TIFF originals): writes camera, lens, exposure, date
 * and — only if requested — GPS. Orientation is always 1 (pixels are upright).
 */
import type { ImageMetadataSummary } from "@/lib/imageMetadata";

const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;

interface Entry {
  tag: number;
  type: number;
  count: number;
  data: Uint8Array; // big-endian encoded value(s)
}

const be = {
  u16: (n: number) => new Uint8Array([(n >> 8) & 255, n & 255]),
  u32: (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]),
};
const ascii = (s: string) => new TextEncoder().encode(s.replace(/[^\x20-\x7e]/g, "?").slice(0, 200) + "\0");
function rational(v: number): Uint8Array {
  let den = 1;
  while (Math.abs(v * den - Math.round(v * den)) > 1e-6 && den < 1e6) den *= 10;
  const out = new Uint8Array(8);
  out.set(be.u32(Math.round(v * den)), 0);
  out.set(be.u32(den), 4);
  return out;
}
const rationals = (vals: number[]) => {
  const out = new Uint8Array(8 * vals.length);
  vals.forEach((v, i) => out.set(rational(v), 8 * i));
  return out;
};
/** Exposure time as 1/n where sensible (e.g. 1/250). */
function exposureRational(t: number): Uint8Array {
  const out = new Uint8Array(8);
  if (t < 1) {
    out.set(be.u32(1), 0);
    out.set(be.u32(Math.round(1 / t)), 4);
    return out;
  }
  return rational(t);
}
const exifDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
function dms(deg: number): number[] {
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const mFloat = (a - d) * 60;
  const m = Math.floor(mFloat);
  return [d, m, Math.round((mFloat - m) * 60 * 100) / 100];
}

/** Serialise IFDs into a big-endian TIFF block. */
function writeTiff(ifds: { entries: Entry[]; linkTag?: { parent: number; tag: number } }[]): Uint8Array {
  // Layout: header(8) | IFD0 | data0 | IFD1 | data1 ...
  const sizes = ifds.map((ifd) => {
    const dataLen = ifd.entries.reduce((a, e) => a + (e.data.length > 4 ? e.data.length + (e.data.length % 2) : 0), 0);
    return { ifd: 2 + ifd.entries.length * 12 + 4, data: dataLen };
  });
  const offsets: number[] = [];
  let pos = 8;
  for (const s of sizes) {
    offsets.push(pos);
    pos += s.ifd + s.data;
  }
  // Fill in pointer tags (Exif IFD / GPS IFD) now that offsets are known.
  ifds.forEach((ifd, i) => {
    if (!ifd.linkTag) return;
    const parent = ifds[ifd.linkTag.parent];
    const e = parent.entries.find((x) => x.tag === ifd.linkTag!.tag);
    if (e) e.data = be.u32(offsets[i]);
  });
  const out = new Uint8Array(pos);
  out.set([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8]);
  ifds.forEach((ifd, i) => {
    const entries = [...ifd.entries].sort((a, b) => a.tag - b.tag);
    let p = offsets[i];
    let data = p + sizes[i].ifd;
    out.set(be.u16(entries.length), p);
    p += 2;
    for (const e of entries) {
      out.set(be.u16(e.tag), p);
      out.set(be.u16(e.type), p + 2);
      out.set(be.u32(e.count), p + 4);
      if (e.data.length <= 4) out.set(e.data, p + 8);
      else {
        out.set(be.u32(data), p + 8);
        out.set(e.data, data);
        data += e.data.length + (e.data.length % 2);
      }
      p += 12;
    }
    out.set(be.u32(0), p); // no next IFD
  });
  return out;
}

export function buildExif(m: ImageMetadataSummary, opts: { includeGps: boolean; software?: string }): Uint8Array {
  const ifd0: Entry[] = [];
  const exif: Entry[] = [];
  const gps: Entry[] = [];
  const str = (tag: number, s: string | undefined, list = ifd0) => {
    if (!s) return;
    const d = ascii(s);
    list.push({ tag, type: ASCII, count: d.length, data: d });
  };
  str(0x010f, m.make);
  str(0x0110, m.model);
  ifd0.push({ tag: 0x0112, type: SHORT, count: 1, data: new Uint8Array([0, 1, 0, 0]) }); // Orientation = 1
  str(0x0131, opts.software ?? "ProStudio");
  const date = m.dateTaken ? exifDate(m.dateTaken) : null;
  if (date) str(0x0132, date);

  if (m.exposureTime) exif.push({ tag: 0x829a, type: RATIONAL, count: 1, data: exposureRational(m.exposureTime) });
  if (m.fNumber) exif.push({ tag: 0x829d, type: RATIONAL, count: 1, data: rational(m.fNumber) });
  if (m.iso) exif.push({ tag: 0x8827, type: SHORT, count: 1, data: new Uint8Array([...be.u16(Math.min(65535, Math.round(m.iso))), 0, 0]) });
  if (date) str(0x9003, date, exif);
  if (m.focalLength) exif.push({ tag: 0x920a, type: RATIONAL, count: 1, data: rational(m.focalLength) });
  str(0xa434, m.lens, exif);

  const includeGps = opts.includeGps && m.hasGps && m.latitude !== undefined && m.longitude !== undefined;
  if (includeGps) {
    gps.push({ tag: 0x0000, type: 1, count: 4, data: new Uint8Array([2, 3, 0, 0]) }); // GPSVersionID
    gps.push({ tag: 0x0001, type: ASCII, count: 2, data: ascii(m.latitude! >= 0 ? "N" : "S") });
    gps.push({ tag: 0x0002, type: RATIONAL, count: 3, data: rationals(dms(m.latitude!)) });
    gps.push({ tag: 0x0003, type: ASCII, count: 2, data: ascii(m.longitude! >= 0 ? "E" : "W") });
    gps.push({ tag: 0x0004, type: RATIONAL, count: 3, data: rationals(dms(m.longitude!)) });
  }
  const ifds: { entries: Entry[]; linkTag?: { parent: number; tag: number } }[] = [{ entries: ifd0 }];
  if (exif.length) {
    ifd0.push({ tag: 0x8769, type: LONG, count: 1, data: be.u32(0) });
    ifds.push({ entries: exif, linkTag: { parent: 0, tag: 0x8769 } });
  }
  if (gps.length) {
    ifd0.push({ tag: 0x8825, type: LONG, count: 1, data: be.u32(0) });
    ifds.push({ entries: gps, linkTag: { parent: 0, tag: 0x8825 } });
  }
  return writeTiff(ifds);
}

/** JPEG APP1 "Exif" segment for a TIFF block. */
export function exifJpegSegment(tiff: Uint8Array): Uint8Array {
  const len = 2 + 6 + tiff.length;
  const seg = new Uint8Array(2 + len);
  seg.set([0xff, 0xe1, len >> 8, len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  seg.set(tiff, 10);
  return seg;
}

/** Insert segments right after SOI (and after APP0/JFIF if present). */
export function insertJpegSegments(jpeg: Uint8Array, segments: Uint8Array[]): Uint8Array {
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4] << 8) | jpeg[5]);
  const total = jpeg.length + segments.reduce((a, s) => a + s.length, 0);
  const out = new Uint8Array(total);
  out.set(jpeg.subarray(0, at), 0);
  let o = at;
  for (const s of segments) {
    out.set(s, o);
    o += s.length;
  }
  out.set(jpeg.subarray(at), o);
  return out;
}
