/**
 * ICC profile support.
 *
 * ProStudio's pipeline works in sRGB (browsers decode images to sRGB). Exports
 * are therefore tagged with a genuine sRGB profile, generated here from the
 * IEC 61966-2-1 definition (D50-adapted primaries, sRGB transfer curve) as an
 * ICC v2.1 display profile. We never attach a source profile (e.g. Display P3)
 * to pixels that were already converted to sRGB.
 */
import { zlibSync } from "fflate";
import { linearToSrgb, srgbToLinear } from "./math";

const D50 = [0.9642, 1.0, 0.8249];
// sRGB primaries, Bradford-adapted to D50 (ICC standard values).
const R_XYZ = [0.4360747, 0.2225045, 0.0139322];
const G_XYZ = [0.3850649, 0.7168786, 0.0971045];
const B_XYZ = [0.1430804, 0.0606169, 0.7141733];

export const SRGB_PROFILE_DESCRIPTION = "sRGB IEC61966-2.1 (ProStudio)";

function s15f16(v: number): number {
  return Math.round(v * 65536) | 0;
}

/** Build an ICC v2.1 sRGB display profile. */
export function buildSrgbIcc(): Uint8Array {
  const enc = new TextEncoder();
  const tags: { sig: string; data: Uint8Array }[] = [];

  const xyz = (v: number[]) => {
    const b = new DataView(new ArrayBuffer(20));
    b.setUint32(0, 0x58595a20); // 'XYZ '
    v.forEach((n, i) => b.setInt32(8 + i * 4, s15f16(n)));
    return new Uint8Array(b.buffer);
  };
  const curve = () => {
    const n = 1024;
    const b = new DataView(new ArrayBuffer(12 + n * 2));
    b.setUint32(0, 0x63757276); // 'curv'
    b.setUint32(8, n);
    // TRC maps encoded → linear.
    for (let i = 0; i < n; i++) b.setUint16(12 + i * 2, Math.round(srgbToLinear(i / (n - 1)) * 65535));
    return new Uint8Array(b.buffer);
  };
  const desc = (text: string) => {
    const ascii = enc.encode(text + "\0");
    const len = 12 + ascii.length + 4 + 4 + 2 + 1 + 67;
    const b = new Uint8Array(len + ((4 - (len % 4)) % 4));
    const v = new DataView(b.buffer);
    v.setUint32(0, 0x64657363); // 'desc'
    v.setUint32(8, ascii.length);
    b.set(ascii, 12);
    return b; // Unicode/ScriptCode counts left zero (allowed)
  };
  const text = (t: string) => {
    const a = enc.encode(t + "\0");
    const b = new Uint8Array(8 + a.length + ((4 - ((8 + a.length) % 4)) % 4));
    new DataView(b.buffer).setUint32(0, 0x74657874); // 'text'
    b.set(a, 8);
    return b;
  };

  const trc = curve();
  tags.push({ sig: "desc", data: desc(SRGB_PROFILE_DESCRIPTION) });
  tags.push({ sig: "cprt", data: text("No copyright, use freely") });
  tags.push({ sig: "wtpt", data: xyz(D50) });
  tags.push({ sig: "rXYZ", data: xyz(R_XYZ) });
  tags.push({ sig: "gXYZ", data: xyz(G_XYZ) });
  tags.push({ sig: "bXYZ", data: xyz(B_XYZ) });
  tags.push({ sig: "rTRC", data: trc });
  tags.push({ sig: "gTRC", data: trc });
  tags.push({ sig: "bTRC", data: trc });

  const headerSize = 128;
  const tableSize = 4 + tags.length * 12;
  // Identical TRC data is stored once and shared by the three TRC tags.
  const offsets = new Map<Uint8Array, number>();
  let offset = headerSize + tableSize;
  const blobs: Uint8Array[] = [];
  for (const t of tags) {
    if (!offsets.has(t.data)) {
      offsets.set(t.data, offset);
      blobs.push(t.data);
      offset += t.data.length;
    }
  }
  const total = offset;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, total);
  v.setUint32(4, 0); // preferred CMM: none
  v.setUint32(8, 0x02100000); // version 2.1
  const sig = (o: number, s: string) => out.set(enc.encode(s), o);
  sig(12, "mntr");
  sig(16, "RGB ");
  sig(20, "XYZ ");
  v.setUint16(24, 2024);
  v.setUint16(26, 1);
  v.setUint16(28, 1);
  sig(36, "acsp");
  v.setUint32(64, 0); // rendering intent: perceptual
  v.setInt32(68, s15f16(D50[0]));
  v.setInt32(72, s15f16(D50[1]));
  v.setInt32(76, s15f16(D50[2]));
  v.setUint32(headerSize, tags.length);
  tags.forEach((t, i) => {
    const p = headerSize + 4 + i * 12;
    sig(p, t.sig);
    v.setUint32(p + 4, offsets.get(t.data)!);
    v.setUint32(p + 8, t.data.length);
  });
  let o = headerSize + tableSize;
  for (const b of blobs) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

let cached: Uint8Array | null = null;
export function srgbIcc(): Uint8Array {
  return (cached ??= buildSrgbIcc());
}

/** JPEG APP2 ICC_PROFILE segment(s) for a profile (single chunk; our profile is small). */
export function iccJpegSegment(profile: Uint8Array): Uint8Array {
  const id = new TextEncoder().encode("ICC_PROFILE\0");
  const len = 2 + id.length + 2 + profile.length;
  const seg = new Uint8Array(2 + len);
  seg[0] = 0xff;
  seg[1] = 0xe2;
  seg[2] = len >> 8;
  seg[3] = len & 0xff;
  seg.set(id, 4);
  seg[4 + id.length] = 1; // chunk 1
  seg[5 + id.length] = 1; // of 1
  seg.set(profile, 6 + id.length);
  return seg;
}

/** PNG iCCP chunk data (name, compression method, zlib-compressed profile). */
export function iccPngChunkData(profile: Uint8Array, name = "sRGB"): Uint8Array {
  const n = new TextEncoder().encode(name);
  const z = zlibSync(profile, { level: 9 });
  const out = new Uint8Array(n.length + 2 + z.length);
  out.set(n, 0);
  out[n.length] = 0;
  out[n.length + 1] = 0;
  out.set(z, n.length + 2);
  return out;
}

/** Recognise wide-gamut source profiles by description (from EXIF/ICC metadata). */
export function isWideGamutProfile(description: string | undefined): boolean {
  if (!description) return false;
  return /display\s*p3|p3|adobe\s*rgb|prophoto|rec\.?\s*2020|bt\.?\s*2020|wide/i.test(description) && !/srgb/i.test(description);
}

// Re-exported for tests: the curve must round-trip.
export const _test = { linearToSrgb };
