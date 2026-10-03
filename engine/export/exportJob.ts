/**
 * One export: full-resolution render from the original → optional user resize →
 * encode → metadata. Environment-agnostic (worker or main thread).
 */
import { renderFullResolution, resizeCanvas } from "@/engine/render/renderFull";
import { encodeCanvas, FORMAT_INFO, insertPngChunk, insertPngExif, pngHasChunk, type EncodeFormat } from "./encoders";
import { buildExif, exifJpegSegment } from "./exifWriter";
import { iccJpegSegment, iccPngChunkData, srgbIcc } from "@/engine/color/icc";
import type { ImageMetadataSummary } from "@/lib/imageMetadata";
import { readJpegSegments, sanitizeExifSegment, transplantJpegMetadata } from "@/lib/imageMetadata";
import type { EditRecipe } from "@/types/edit";
import type { LutData } from "@/engine/gl/WebGLRenderer";
import { collectAssetIds, type LayerDoc } from "@/types/layers";
import { AssetCache } from "@/engine/layers/assetCache";

export interface ExportJob {
  source: ImageBitmap;
  /** Original file bytes — only needed to carry EXIF across (JPEG originals). */
  originalBytes: ArrayBuffer | null;
  recipe: EditRecipe;
  lut: LutData | null;
  format: EncodeFormat;
  quality: number; // 1..100 (lossy formats)
  /** Target size; null keeps the full rendered size. */
  width: number | null;
  height: number | null;
  transparency: boolean;
  background: string;
  preserveMetadata: boolean;
  stripGps: boolean;
  /** Parsed metadata of the original — written as fresh EXIF when there is no JPEG EXIF block to copy. */
  metadataSummary?: ImageMetadataSummary | null;
  /** Tag JPEG/PNG output with an sRGB ICC profile (the pixels are sRGB). */
  embedIcc?: boolean;
  preferGpu: boolean;
  /** Layer stack and the asset blobs it references (images, raster masks). */
  layers: LayerDoc[];
  assetBlobs: Record<string, Blob>;
}

export interface ExportResult {
  blob: Blob;
  width: number;
  height: number;
  usedGpu: boolean;
  metadataWritten: boolean;
  iccEmbedded: boolean;
}

export async function runExport(job: ExportJob, onProgress?: (f: number, msg: string) => void): Promise<ExportResult> {
  const assets = new AssetCache(async (id) => job.assetBlobs[id]);
  await assets.ensure(collectAssetIds(job.layers));
  const rendered = await renderFullResolution({
    source: job.source,
    recipe: job.recipe,
    lut: job.lut,
    preferGpu: job.preferGpu,
    layers: job.layers,
    assets,
    onProgress: (f, m) => onProgress?.(f * 0.85, m),
  });
  assets.dispose();
  let canvas = rendered.canvas;
  if (job.width && job.height && (job.width !== rendered.width || job.height !== rendered.height)) {
    onProgress?.(0.87, "Resizing");
    canvas = resizeCanvas(canvas, job.width, job.height);
  }
  onProgress?.(0.9, `Encoding ${FORMAT_INFO[job.format].label}`);
  let blob = await encodeCanvas(canvas, job.format, {
    quality: job.quality,
    transparency: job.transparency,
    background: job.background,
  });

  let metadataWritten = false;
  let iccEmbedded = false;
  if (job.format === "jpeg") {
    let bytes: Uint8Array = new Uint8Array(await blob.arrayBuffer());
    const original = job.preserveMetadata && job.originalBytes ? new Uint8Array(job.originalBytes) : null;
    if (original) {
      // JPEG original: copy its full EXIF (orientation reset, thumbnail dropped, GPS optional).
      const merged = transplantJpegMetadata(original, bytes, { exif: true, icc: false, stripGps: job.stripGps });
      metadataWritten = merged !== bytes;
      bytes = merged;
    }
    const extra: Uint8Array[] = [];
    // Some encoders (WebKit) write their own minimal EXIF/ICC; ours must be the only ones.
    if (!metadataWritten) bytes = stripEncoderMetadata(bytes);
    if (job.preserveMetadata && !metadataWritten && job.metadataSummary) {
      extra.push(exifJpegSegment(buildExif(job.metadataSummary, { includeGps: !job.stripGps })));
      metadataWritten = true;
    }
    if (job.embedIcc !== false) {
      // ICC must follow any APP1; append after inserted EXIF.
      extra.push(iccJpegSegment(srgbIcc()));
      iccEmbedded = true;
    }
    if (extra.length) bytes = insertAfterApp1(bytes, extra);
    blob = new Blob([bytes as BlobPart], { type: "image/jpeg" });
  } else if (job.format === "png") {
    let png: Uint8Array = new Uint8Array(await blob.arrayBuffer());
    if (job.preserveMetadata) {
      const segs = job.originalBytes ? readJpegSegments(new Uint8Array(job.originalBytes)) : null;
      const exif = segs?.segments.find((s) => s.marker === 0xe1 && s.data[4] === 0x45 && s.data[5] === 0x78);
      if (exif) {
        png = insertPngExif(png, sanitizeExifSegment(exif.data, { stripGps: job.stripGps }).subarray(10));
        metadataWritten = true;
      } else if (job.metadataSummary) {
        png = insertPngExif(png, buildExif(job.metadataSummary, { includeGps: !job.stripGps }));
        metadataWritten = true;
      }
    }
    if (job.embedIcc !== false && !pngHasChunk(png, "iCCP") && !pngHasChunk(png, "sRGB")) {
      png = insertPngChunk(png, "iCCP", iccPngChunkData(srgbIcc()));
      iccEmbedded = true;
    }
    blob = new Blob([png as BlobPart], { type: "image/png" });
  }
  onProgress?.(1, "Done");
  return { blob, width: canvas.width, height: canvas.height, usedGpu: rendered.usedGpu, metadataWritten, iccEmbedded };
}

/** Remove EXIF (APP1 "Exif") and ICC (APP2 "ICC_PROFILE") segments written by the browser's encoder. */
function stripEncoderMetadata(jpeg: Uint8Array): Uint8Array {
  const parsed = readJpegSegments(jpeg);
  if (!parsed) return jpeg;
  const isExif = (d: Uint8Array) => d[1] === 0xe1 && d[4] === 0x45 && d[5] === 0x78 && d[6] === 0x69 && d[7] === 0x66;
  const isIcc = (d: Uint8Array) => d[1] === 0xe2 && String.fromCharCode(...d.subarray(4, 15)) === "ICC_PROFILE";
  const keep = parsed.segments.filter((s) => !isExif(s.data) && !isIcc(s.data));
  if (keep.length === parsed.segments.length) return jpeg;
  const parts = [new Uint8Array([0xff, 0xd8]), ...keep.map((s) => s.data), jpeg.subarray(parsed.bodyStart)];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Insert segments after SOI/APP0 and any APP1 (EXIF must come before ICC APP2). */
function insertAfterApp1(jpeg: Uint8Array, segments: Uint8Array[]): Uint8Array {
  let at = 2;
  while (jpeg[at] === 0xff && (jpeg[at + 1] === 0xe0 || jpeg[at + 1] === 0xe1)) at += 2 + ((jpeg[at + 2] << 8) | jpeg[at + 3]);
  // insertJpegSegments inserts after SOI/APP0 — emulate at a custom position.
  const head = jpeg.subarray(0, at);
  const tail = jpeg.subarray(at);
  const out = new Uint8Array(jpeg.length + segments.reduce((a, s) => a + s.length, 0));
  out.set(head, 0);
  let o = head.length;
  for (const s of segments) {
    out.set(s, o);
    o += s.length;
  }
  out.set(tail, o);
  return out;
}
