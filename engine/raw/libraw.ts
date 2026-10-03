/**
 * RAW decoding with LibRaw compiled to WebAssembly (libraw-wasm, loaded at
 * runtime from /wasm/libraw/ — same-origin, only when a RAW file is opened).
 *
 * Pipeline (LibRaw stage): decode → demosaic (AHD) → camera (as-shot) white
 * balance → highlight recovery (blend) → camera matrix → sRGB. The result feeds
 * ProStudio's non-destructive editor (exposure, shadows/highlights, colour,
 * noise reduction…) and full-resolution export. The RAW file itself is stored
 * byte-for-byte and never modified.
 */
import { UnsupportedFormatError, type SniffedFormat } from "@/lib/fileUtils";
import type { ImageMetadataSummary } from "@/lib/imageMetadata";

interface LibRawInstance {
  open(data: Uint8Array, settings: Record<string, unknown>): Promise<unknown>;
  metadata(full?: boolean): Promise<Record<string, unknown> | undefined>;
  imageData(): Promise<{ width: number; height: number; bits?: number; colors?: number; data: Uint8Array | Uint16Array } | undefined>;
  dispose(): void;
}
type LibRawCtor = new () => LibRawInstance;

/** LibRaw processing settings for ProStudio's RAW pipeline. */
export const RAW_DECODE_SETTINGS = {
  useCameraWb: true, // as-shot white balance (editable afterwards via Temperature/Tint)
  useCameraMatrix: 1,
  outputColor: 1, // sRGB
  outputBps: 8,
  userQual: 3, // AHD demosaic
  highlight: 2, // blend: recovers detail in partially clipped highlights
  autoBrightThr: 0.001, // limit auto-brightening clipping to 0.1%
  noAutoBright: false,
  halfSize: false,
} as const;

let ctorPromise: Promise<LibRawCtor> | null = null;
function loadLibRaw(): Promise<LibRawCtor> {
  if (!ctorPromise) {
    ctorPromise = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "/wasm/libraw/index.js" as string)
      .then((m: { default: LibRawCtor }) => m.default)
      .catch((e) => {
        ctorPromise = null;
        throw new UnsupportedFormatError(`The RAW decoder could not be loaded (${(e as Error).message}).`);
      });
  }
  return ctorPromise;
}

interface Decoded {
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

// Decoding a RAW takes seconds; reuse the result for the same file within a session.
const cache = new WeakMap<Blob, Promise<Decoded>>();

async function decode(blob: Blob, format: SniffedFormat): Promise<Decoded> {
  const LibRaw = await loadLibRaw();
  const raw = new LibRaw();
  try {
    try {
      await raw.open(new Uint8Array(await blob.arrayBuffer()), { ...RAW_DECODE_SETTINGS });
    } catch {
      throw new UnsupportedFormatError(`This ${format.toUpperCase()} file could not be opened by LibRaw (unsupported camera or corrupt file).`);
    }
    let img: Awaited<ReturnType<LibRawInstance["imageData"]>>;
    try {
      img = await raw.imageData();
    } catch (e) {
      throw new UnsupportedFormatError(
        `This ${format.toUpperCase()} file uses a compression or sensor layout this browser build of LibRaw cannot decode (${(e as Error).message}).`,
      );
    }
    if (!img || !img.width || !img.height) throw new UnsupportedFormatError("The RAW decoder returned no image.");
    const { width: w, height: h } = img;
    const colors = img.colors ?? 3;
    const shift = (img.bits ?? 8) > 8 ? 8 : 0;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const d = img.data;
    for (let i = 0; i < w * h; i++) {
      for (let c = 0; c < 3; c++) rgba[i * 4 + c] = d[i * colors + Math.min(c, colors - 1)] >> shift;
      rgba[i * 4 + 3] = 255;
    }
    return { width: w, height: h, rgba };
  } finally {
    raw.dispose();
  }
}

export async function decodeWithLibRaw(blob: Blob, format: SniffedFormat): Promise<ImageBitmap> {
  let p = cache.get(blob);
  if (!p) {
    p = decode(blob, format);
    cache.set(blob, p);
    p.catch(() => cache.delete(blob));
  }
  const d = await p;
  return createImageBitmap(new ImageData(d.rgba, d.width, d.height), { premultiplyAlpha: "none" });
}

/** Camera/lens/exposure metadata from LibRaw (works for CR3/RAF where EXIF parsers may not). */
export async function readRawMetadata(blob: Blob): Promise<ImageMetadataSummary | null> {
  try {
    const LibRaw = await loadLibRaw();
    const raw = new LibRaw();
    try {
      await raw.open(new Uint8Array(await blob.arrayBuffer()), { ...RAW_DECODE_SETTINGS, halfSize: true });
      // Full metadata (with lens info) fails in some engines (WebKit); fall back to the basic block.
      const m = (await raw.metadata(true).catch(() => raw.metadata(false))) ?? {};
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined);
      const lens = (m.lens ?? {}) as Record<string, unknown>;
      const gps = (m.gps_data ?? {}) as { latitude?: number[] };
      const ts = m.timestamp instanceof Date ? m.timestamp : null;
      return {
        make: str(m.camera_make),
        model: str(m.camera_model),
        lens: str(lens.Lens) ?? str(lens.LensModel),
        iso: num(m.iso_speed),
        exposureTime: num(m.shutter),
        fNumber: num(m.aperture),
        focalLength: num(m.focal_len),
        dateTaken: ts && ts.getTime() > 0 ? ts.toISOString() : undefined,
        hasGps: Array.isArray(gps.latitude) && gps.latitude.some((v) => v !== 0),
        software: "Decoded with LibRaw",
      };
    } finally {
      raw.dispose();
    }
  } catch {
    return null;
  }
}
