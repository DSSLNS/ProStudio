/**
 * Safe file intake: magic-byte sniffing (never trust the extension or the
 * browser-reported MIME alone), size limits, and decoding to ImageBitmap.
 */

export type SniffedFormat =
  | "jpeg"
  | "png"
  | "gif"
  | "webp"
  | "avif"
  | "heic"
  | "bmp"
  | "tiff"
  | "svg"
  | "dng"
  | "cr2"
  | "cr3"
  | "nef"
  | "arw"
  | "raf"
  | "prostudio"
  | "unknown";

export const RAW_FORMATS: SniffedFormat[] = ["dng", "cr2", "cr3", "nef", "arw", "raf"];

export const MAX_FILE_BYTES = 512 * 1024 * 1024; // hard safety cap
export const MAX_DECODE_PIXELS = 268e6; // browser canvas hard limits are ~268MP on desktop

export const ACCEPT_ATTR =
  "image/*,.jpg,.jpeg,.png,.webp,.avif,.gif,.bmp,.tif,.tiff,.heic,.heif,.svg,.dng,.cr2,.cr3,.nef,.arw,.raf,.prostudio";

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));

export async function sniffFormat(file: Blob, name = ""): Promise<SniffedFormat> {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (ascii(head, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (ascii(head, 0, 4) === "GIF8") return "gif";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return "webp";
  if (ascii(head, 0, 2) === "BM") return "bmp";
  // ZIP whose first entry is project.json (local header name starts at byte 30).
  if (ascii(head, 0, 4) === "PK\x03\x04" && (ext === "prostudio" || ascii(head, 30, 12) === "project.json"))
    return "prostudio";
  if (ascii(head, 4, 4) === "ftyp") {
    const brand = ascii(head, 8, 4);
    if (brand === "avif" || brand === "avis") return "avif";
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"].includes(brand)) return "heic";
    if (brand === "crx ") return "cr3";
  }
  if (ascii(head, 0, 8) === "FUJIFILM") return "raf";
  const tiffLE = head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a && head[3] === 0;
  const tiffBE = head[0] === 0x4d && head[1] === 0x4d && head[2] === 0 && head[3] === 0x2a;
  if (tiffLE || tiffBE) {
    if (tiffLE && head[8] === 0x43 && head[9] === 0x52) return "cr2"; // "CR" marker
    if (ext === "dng") return "dng";
    if (ext === "nef") return "nef";
    if (ext === "arw") return "arw";
    if (ext === "cr2") return "cr2";
    // DNGVersion tag (0xC612) in IFD0 identifies DNG regardless of extension.
    if (findTiffTag(head, tiffLE, 0xc612)) return "dng";
    return "tiff";
  }
  const text = new TextDecoder().decode(head).trimStart().toLowerCase();
  if (text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"))) return "svg";
  return "unknown";
}

function findTiffTag(head: Uint8Array, le: boolean, tag: number): boolean {
  const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const ifd = v.getUint32(4, le);
  if (ifd + 2 > head.length) return false;
  const n = v.getUint16(ifd, le);
  for (let i = 0; i < n; i++) {
    const p = ifd + 2 + i * 12;
    if (p + 2 > head.length) return false;
    if (v.getUint16(p, le) === tag) return true;
  }
  return false;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatMegapixels(w: number, h: number): string {
  return `${w} × ${h} — ${((w * h) / 1e6).toFixed(1)} MP`;
}

export class UnsupportedFormatError extends Error {}

/**
 * Decode a still image to an oriented ImageBitmap.
 * SVG is rasterised through an <img> element — browsers never run scripts in
 * SVG loaded as an image, which is what makes this safe.
 */
export async function decodeToBitmap(
  blob: Blob,
  format: SniffedFormat,
  opts: { maxLongEdge?: number } = {},
): Promise<ImageBitmap> {
  if (RAW_FORMATS.includes(format)) {
    const { decodeRaw } = await import("@/engine/raw/decodeRaw");
    const bmp = await decodeRaw(blob, format);
    return opts.maxLongEdge ? downscaleBitmap(bmp, opts.maxLongEdge, true) : bmp;
  }
  if (format === "tiff") {
    const { decodeTiff } = await import("@/engine/raw/decodeRaw");
    const bmp = await decodeTiff(blob);
    return opts.maxLongEdge ? downscaleBitmap(bmp, opts.maxLongEdge, true) : bmp;
  }
  if (format === "svg") return rasterizeSvg(blob, opts.maxLongEdge ?? 4096);
  if (format === "unknown" || format === "prostudio") {
    throw new UnsupportedFormatError("This file is not a recognised image format.");
  }
  let full: ImageBitmap;
  try {
    full = await createImageBitmap(blob, {
      imageOrientation: "from-image",
      premultiplyAlpha: "none",
      colorSpaceConversion: "default",
    });
  } catch {
    if (format === "heic") {
      // No native HEIC support (most browsers except Safari): decode with libheif (WebAssembly).
      try {
        const { decodeHeicWasm } = await import("@/engine/heic/decodeHeic");
        full = await decodeHeicWasm(blob);
      } catch (e) {
        throw new UnsupportedFormatError(`This HEIC/HEIF file could not be decoded (${(e as Error).message}).`);
      }
      if (opts.maxLongEdge && Math.max(full.width, full.height) > opts.maxLongEdge) {
        return downscaleBitmap(full, opts.maxLongEdge, true);
      }
      return full;
    }
    throw new UnsupportedFormatError(
      `This ${format.toUpperCase()} file could not be decoded by your browser. It may be corrupt.`,
    );
  }
  if (full.width * full.height > MAX_DECODE_PIXELS) {
    full.close();
    throw new UnsupportedFormatError(
      "This image exceeds the maximum size browsers can process (about 268 megapixels).",
    );
  }
  if (opts.maxLongEdge && Math.max(full.width, full.height) > opts.maxLongEdge) {
    return downscaleBitmap(full, opts.maxLongEdge, true);
  }
  return full;
}

/** High-quality downscale. Optionally closes the input bitmap to free memory. */
export async function downscaleBitmap(
  src: ImageBitmap,
  maxLongEdge: number,
  closeSource: boolean,
): Promise<ImageBitmap> {
  const scale = maxLongEdge / Math.max(src.width, src.height);
  if (scale >= 1) return src;
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  let out: ImageBitmap;
  try {
    out = await createImageBitmap(src, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
  } catch {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, w, h);
    out = c.transferToImageBitmap();
  }
  if (closeSource) src.close();
  return out;
}

async function rasterizeSvg(blob: Blob, longEdge: number): Promise<ImageBitmap> {
  const safe = new Blob([await blob.arrayBuffer()], { type: "image/svg+xml" });
  const url = URL.createObjectURL(safe);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const iw = img.naturalWidth || 1024;
    const ih = img.naturalHeight || 1024;
    const s = longEdge / Math.max(iw, ih);
    const w = Math.round(iw * Math.max(1, s));
    const h = Math.round(ih * Math.max(1, s));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    return await createImageBitmap(c);
  } catch {
    throw new UnsupportedFormatError("This SVG could not be rendered.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Read the oriented pixel dimensions without keeping the full bitmap alive. */
export async function probeDimensions(blob: Blob, format: SniffedFormat): Promise<{ width: number; height: number }> {
  const bmp = await decodeToBitmap(blob, format);
  const dims = { width: bmp.width, height: bmp.height };
  bmp.close();
  return dims;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Save via the File System Access API where available (lets the user pick a folder), else download. */
export async function saveBlobAs(
  blob: Blob,
  filename: string,
  description = "Image",
): Promise<"saved" | "downloaded" | "cancelled"> {
  const w = window as unknown as {
    showSaveFilePicker?: (
      o: unknown,
    ) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>;
  };
  if (w.showSaveFilePicker) {
    try {
      const ext = filename.split(".").pop() ?? "";
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description, accept: { [blob.type || "application/octet-stream"]: [`.${ext}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "saved";
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return "cancelled";
      // fall through to a regular download on any other failure
    }
  }
  downloadBlob(blob, filename);
  return "downloaded";
}

export function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "") || "photo";
}
