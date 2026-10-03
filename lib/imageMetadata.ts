/**
 * EXIF/metadata reading (via exifr) plus JPEG metadata transplant for export.
 */

export interface ImageMetadataSummary {
  make?: string;
  model?: string;
  lens?: string;
  iso?: number;
  exposureTime?: number; // seconds
  fNumber?: number;
  focalLength?: number;
  dateTaken?: string;
  hasGps: boolean;
  latitude?: number;
  longitude?: number;
  orientation?: number;
  colorSpace?: string;
  software?: string;
}

export async function readMetadata(blob: Blob): Promise<ImageMetadataSummary | null> {
  try {
    const exifr = (await import("exifr")).default;
    const data = await exifr.parse(blob, {
      tiff: true,
      exif: true,
      gps: true,
      icc: true,
      xmp: false,
      translateValues: true,
      reviveValues: true,
    });
    if (!data) return null;
    const d = data as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined);
    const date = d.DateTimeOriginal ?? d.CreateDate;
    return {
      make: str(d.Make),
      model: str(d.Model),
      lens: str(d.LensModel) ?? str(d.Lens),
      iso: num(d.ISO),
      exposureTime: num(d.ExposureTime),
      fNumber: num(d.FNumber),
      focalLength: num(d.FocalLength),
      dateTaken: date instanceof Date ? date.toISOString() : str(date),
      hasGps: num(d.latitude) !== undefined,
      latitude: num(d.latitude),
      longitude: num(d.longitude),
      orientation: typeof d.Orientation === "number" ? d.Orientation : undefined,
      colorSpace: str(d.ProfileDescription) ?? str(d.ColorSpaceData),
      software: str(d.Software),
    };
  } catch {
    return null;
  }
}

export function formatShutter(seconds: number): string {
  if (seconds >= 1) return `${seconds.toFixed(seconds % 1 ? 1 : 0)}s`;
  return `1/${Math.round(1 / seconds)}`;
}

// ---------------------------------------------------------------------------
// JPEG segment handling: copy APP1 (EXIF) and APP2 (ICC) from the original into
// an exported JPEG. Orientation is reset to 1 (pixels are already oriented),
// the embedded thumbnail is dropped (it would show the unedited image), and GPS
// can be removed.
// ---------------------------------------------------------------------------

interface JpegSegment {
  marker: number;
  data: Uint8Array; // full segment incl. marker + length
}

export function readJpegSegments(bytes: Uint8Array): { segments: JpegSegment[]; bodyStart: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const segments: JpegSegment[] = [];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xda) break; // start of scan
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) return null;
    segments.push({ marker, data: bytes.subarray(i, i + 2 + len) });
    i += 2 + len;
  }
  return { segments, bodyStart: i };
}

function isExifApp1(seg: JpegSegment): boolean {
  const d = seg.data;
  return (
    seg.marker === 0xe1 && d[4] === 0x45 && d[5] === 0x78 && d[6] === 0x69 && d[7] === 0x66 && d[8] === 0 && d[9] === 0
  );
}

function isIccApp2(seg: JpegSegment): boolean {
  const sig = "ICC_PROFILE";
  if (seg.marker !== 0xe2) return false;
  for (let k = 0; k < sig.length; k++) if (seg.data[4 + k] !== sig.charCodeAt(k)) return false;
  return true;
}

/**
 * Mutates a copy of an EXIF APP1 segment: Orientation→1, drop IFD1 (thumbnail),
 * optionally empty the GPS IFD.
 */
export function sanitizeExifSegment(segment: Uint8Array, opts: { stripGps: boolean }): Uint8Array {
  const out = segment.slice();
  const tiff = 10; // marker(2) + len(2) + "Exif\0\0"(6)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const le = out[tiff] === 0x49;
  const u16 = (o: number) => view.getUint16(tiff + o, le);
  const u32 = (o: number) => view.getUint32(tiff + o, le);
  const setU16 = (o: number, v: number) => view.setUint16(tiff + o, v, le);
  const setU32 = (o: number, v: number) => view.setUint32(tiff + o, v, le);
  const tiffLen = out.length - tiff;
  try {
    const ifd0 = u32(4);
    if (ifd0 + 2 > tiffLen) return out;
    const count = u16(ifd0);
    for (let e = 0; e < count; e++) {
      const entry = ifd0 + 2 + e * 12;
      if (entry + 12 > tiffLen) break;
      const tag = u16(entry);
      if (tag === 0x0112) setU16(entry + 8, 1); // Orientation = top-left
      if (tag === 0x8825 && opts.stripGps) {
        const gpsOffset = u32(entry + 8);
        if (gpsOffset + 2 <= tiffLen) {
          const gpsCount = u16(gpsOffset);
          // Zero the GPS entries' bytes, then set the GPS IFD to zero entries.
          for (let b = 2; b < 2 + gpsCount * 12 + 4 && gpsOffset + b < tiffLen; b++) out[tiff + gpsOffset + b] = 0;
          setU16(gpsOffset, 0);
        }
      }
    }
    const nextIfdPos = ifd0 + 2 + count * 12;
    if (nextIfdPos + 4 <= tiffLen) setU32(nextIfdPos, 0); // drop thumbnail IFD1
  } catch {
    /* malformed EXIF: return as-is copy */
  }
  return out;
}

/** Insert EXIF/ICC from `original` JPEG into `encoded` JPEG (both full files). */
export function transplantJpegMetadata(
  original: Uint8Array,
  encoded: Uint8Array,
  opts: { exif: boolean; icc: boolean; stripGps: boolean },
): Uint8Array {
  const src = readJpegSegments(original);
  const dst = readJpegSegments(encoded);
  if (!src || !dst) return encoded;
  const extra: Uint8Array[] = [];
  if (opts.exif) {
    const exif = src.segments.find(isExifApp1);
    if (exif) extra.push(sanitizeExifSegment(exif.data, { stripGps: opts.stripGps }));
  }
  if (opts.icc) for (const s of src.segments.filter(isIccApp2)) extra.push(s.data);
  if (!extra.length) return encoded;
  // Keep encoder's own segments except any EXIF/ICC it wrote (we replace them).
  const keep = dst.segments.filter((s) => !(opts.exif && isExifApp1(s)) && !(opts.icc && isIccApp2(s)));
  // APP0 (JFIF) must stay first if present.
  const app0 = keep.filter((s) => s.marker === 0xe0);
  const rest = keep.filter((s) => s.marker !== 0xe0);
  const parts = [
    new Uint8Array([0xff, 0xd8]),
    ...app0.map((s) => s.data),
    ...extra,
    ...rest.map((s) => s.data),
    encoded.subarray(dst.bodyStart),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
