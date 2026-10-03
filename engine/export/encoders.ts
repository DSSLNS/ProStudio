/**
 * Encoders for export. JPEG/PNG/WebP/AVIF use the browser's native encoders via
 * OffscreenCanvas.convertToBlob; TIFF is encoded losslessly with UTIF.
 */
import UTIF from "utif";

export type EncodeFormat = "jpeg" | "png" | "webp" | "avif" | "tiff";

export const FORMAT_INFO: Record<
  EncodeFormat,
  { mime: string; ext: string; lossy: boolean; alpha: boolean; label: string }
> = {
  jpeg: { mime: "image/jpeg", ext: "jpg", lossy: true, alpha: false, label: "JPEG" },
  png: { mime: "image/png", ext: "png", lossy: false, alpha: true, label: "PNG (lossless)" },
  webp: { mime: "image/webp", ext: "webp", lossy: true, alpha: true, label: "WebP" },
  avif: { mime: "image/avif", ext: "avif", lossy: true, alpha: true, label: "AVIF" },
  tiff: { mime: "image/tiff", ext: "tif", lossy: false, alpha: true, label: "TIFF (lossless, uncompressed)" },
};

export class EncodeUnsupportedError extends Error {}

export async function encodeCanvas(
  canvas: OffscreenCanvas,
  format: EncodeFormat,
  opts: { quality: number; transparency: boolean; background?: string },
): Promise<Blob> {
  const info = FORMAT_INFO[format];
  let src = canvas;
  // Flatten transparency when the format can't carry it (JPEG) or the user turned it off.
  if (!info.alpha || !opts.transparency) {
    const flat = new OffscreenCanvas(canvas.width, canvas.height);
    const ctx = flat.getContext("2d", { alpha: false })!;
    ctx.fillStyle = opts.background ?? "#ffffff";
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    src = flat;
  }
  if (format === "tiff") {
    const ctx = src.getContext("2d")!;
    const data = ctx.getImageData(0, 0, src.width, src.height).data;
    const buf = UTIF.encodeImage(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), src.width, src.height);
    return new Blob([buf], { type: info.mime });
  }
  const blob = await src.convertToBlob({ type: info.mime, quality: info.lossy ? opts.quality / 100 : undefined });
  if (blob.type !== info.mime) {
    throw new EncodeUnsupportedError(`${info.label} encoding is not supported by this browser.`);
  }
  return blob;
}

/** Insert a PNG chunk right after IHDR. */
export function insertPngChunk(png: Uint8Array, type: string, data: Uint8Array): Uint8Array {
  const ihdrEnd = 8 + 4 + 4 + 13 + 4; // signature + IHDR(len,type,data,crc)
  const chunk = new Uint8Array(12 + data.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  dv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

/** Does the PNG already contain a chunk of this type? */
export function pngHasChunk(png: Uint8Array, type: string): boolean {
  let p = 8;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  while (p + 8 <= png.length) {
    const len = dv.getUint32(p);
    const t = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    if (t === type) return true;
    if (t === "IDAT" || t === "IEND") return false;
    p += 12 + len;
  }
  return false;
}

/** Insert an eXIf chunk into a PNG (after IHDR). `tiffExif` is the raw TIFF-structured EXIF (no "Exif\0\0"). */
export function insertPngExif(png: Uint8Array, tiffExif: Uint8Array): Uint8Array {
  return insertPngChunk(png, "eXIf", tiffExif);
}

let CRC_TABLE: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
