import UTIF from "utif";
import { UnsupportedFormatError, type SniffedFormat } from "@/lib/fileUtils";

/** Decode baseline TIFF (8/16-bit RGB(A), grayscale, palette, LZW/Deflate/PackBits/JPEG). */
export async function decodeTiff(blob: Blob): Promise<ImageBitmap> {
  const buf = await blob.arrayBuffer();
  let ifds: ReturnType<typeof UTIF.decode>;
  try {
    ifds = UTIF.decode(buf);
  } catch {
    throw new UnsupportedFormatError("This TIFF file could not be parsed.");
  }
  // Pick the largest image (multi-page TIFFs often carry thumbnails).
  const page = ifds
    .filter((i) => (i as unknown as Record<string, number[]>)["t256"])
    .sort((a, b) => imgArea(b) - imgArea(a))[0];
  if (!page) throw new UnsupportedFormatError("This TIFF file contains no image data.");
  UTIF.decodeImage(buf, page);
  const rgba = UTIF.toRGBA8(page);
  const w = page.width;
  const h = page.height;
  if (!w || !h || rgba.length < w * h * 4) {
    throw new UnsupportedFormatError(
      "This TIFF uses an encoding that is not supported (e.g. CMYK with unusual layout).",
    );
  }
  const data = new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, w * h * 4), w, h);
  return createImageBitmap(data, { premultiplyAlpha: "none" });
}

function imgArea(i: unknown): number {
  const r = i as Record<string, number[]>;
  return (r["t256"]?.[0] ?? 0) * (r["t257"]?.[0] ?? 0);
}

/** RAW camera files are decoded with LibRaw compiled to WebAssembly (see engine/raw/libraw.ts). */
export async function decodeRaw(blob: Blob, format: SniffedFormat): Promise<ImageBitmap> {
  const { decodeWithLibRaw } = await import("./libraw");
  return decodeWithLibRaw(blob, format);
}
