/**
 * Still capture. Prefers ImageCapture.takePhoto() (full sensor resolution where
 * the browser supports it); falls back to drawing the current video frame at
 * its native videoWidth × videoHeight. Captured pixels are never downscaled,
 * cropped or mirrored — aspect ratio and selfie mirroring are recorded
 * non-destructively in the edit recipe.
 */

import type { CropRect } from "@/types/edit";
import type { CameraCapabilities } from "./capabilities";
import { mergeNightFrames, exposureFusion, type RgbaFrame } from "./multiFrame";

export type CaptureMethod = "takePhoto" | "video-frame" | "night-multiframe" | "hdr-fusion";

export interface CaptureResult {
  blob: Blob;
  width: number;
  height: number;
  method: CaptureMethod;
  mimeType: string;
  /** Extra info for the review screen (e.g. "8 frames aligned and averaged"). */
  note?: string;
}

export type FlashMode = "off" | "auto" | "flash";

interface ImageCaptureLike {
  takePhoto(settings?: Record<string, unknown>): Promise<Blob>;
  getPhotoCapabilities(): Promise<Record<string, unknown>>;
  getPhotoSettings?(): Promise<Record<string, unknown>>;
  grabFrame?(): Promise<ImageBitmap>;
}

type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

export function createImageCapture(track: MediaStreamTrack): ImageCaptureLike | null {
  const Ctor = (globalThis as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
  if (typeof Ctor !== "function") return null;
  try {
    return new Ctor(track);
  } catch {
    return null;
  }
}

export async function getPhotoCapabilities(ic: ImageCaptureLike | null): Promise<Record<string, unknown> | null> {
  if (!ic) return null;
  try {
    return await ic.getPhotoCapabilities();
  } catch {
    return null;
  }
}

export async function blobDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const dims = { width: bmp.width, height: bmp.height };
  bmp.close();
  return dims;
}

/** Full-resolution photo via ImageCapture; uses the largest reported image size unless one is given. */
export async function takePhoto(
  ic: ImageCaptureLike,
  caps: CameraCapabilities,
  opts: { flash?: FlashMode; redEye?: boolean; imageWidth?: number; imageHeight?: number } = {},
): Promise<CaptureResult> {
  const settings: Record<string, unknown> = {};
  const photo = caps.photo;
  if (photo?.imageWidth && photo.imageHeight) {
    settings.imageWidth = opts.imageWidth ?? photo.imageWidth.max;
    settings.imageHeight = opts.imageHeight ?? photo.imageHeight.max;
  }
  if (opts.flash && photo?.fillLightMode.includes(opts.flash)) settings.fillLightMode = opts.flash;
  if (opts.redEye && photo?.redEyeReduction) settings.redEyeReduction = true;
  const blob = await ic.takePhoto(settings);
  const dims = await blobDimensions(blob);
  return { blob, ...dims, method: "takePhoto", mimeType: blob.type || "image/jpeg" };
}

/** Draw the current video frame at native resolution. */
export function drawVideoFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error("The camera preview is not ready yet.");
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas is not available.");
  ctx.drawImage(video, 0, 0, w, h);
  return canvas;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: "image/jpeg" | "image/png" = "image/jpeg",
  quality = 0.95,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Encoding the photo failed."))), type, quality),
  );
}

export async function captureVideoFrame(
  video: HTMLVideoElement,
  type: "image/jpeg" | "image/png" = "image/jpeg",
): Promise<CaptureResult> {
  const canvas = drawVideoFrame(video);
  const blob = await canvasToBlob(canvas, type, 0.95);
  return { blob, width: canvas.width, height: canvas.height, method: "video-frame", mimeType: type };
}

function readFrame(video: HTMLVideoElement): RgbaFrame {
  const canvas = drawVideoFrame(video);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: img.data, width: img.width, height: img.height };
}

/** Wait for the next decoded video frame (rVFC where available, else ~1 frame at 30 fps). */
export function nextVideoFrame(video: HTMLVideoElement): Promise<void> {
  const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
  return new Promise((resolve) => {
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => resolve());
    else setTimeout(resolve, 34);
  });
}

async function rgbaToBlob(frame: RgbaFrame, type: "image/jpeg" | "image/png"): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0);
  return canvasToBlob(canvas, type, 0.95);
}

/**
 * Night (multi-frame): capture N consecutive video frames at full stream
 * resolution, align them (translational search on downsampled luma) and
 * average. Real temporal noise reduction — not a filter.
 */
export async function captureNight(
  video: HTMLVideoElement,
  frameCount = 8,
  onProgress?: (fraction: number) => void,
): Promise<CaptureResult> {
  const frames: RgbaFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    await nextVideoFrame(video);
    frames.push(readFrame(video));
    onProgress?.(((i + 1) / frameCount) * 0.6);
  }
  await new Promise((r) => setTimeout(r, 0));
  const merged = mergeNightFrames(frames);
  onProgress?.(0.9);
  const blob = await rgbaToBlob(merged, "image/png");
  onProgress?.(1);
  return {
    blob,
    width: merged.width,
    height: merged.height,
    method: "night-multiframe",
    mimeType: "image/png",
    note: `Night (multi-frame): ${frameCount} frames aligned and averaged`,
  };
}

/**
 * HDR bracketing: 3 frames at −2/0/+2 EV via exposureCompensation (or ¼×/1×/4×
 * exposureTime in manual mode). Each bracket is verified with getSettings();
 * if the device does not honour the change the capture is aborted honestly.
 * Original settings are restored afterwards.
 */
export async function captureHdr(
  track: MediaStreamTrack,
  video: HTMLVideoElement,
  caps: CameraCapabilities,
  onProgress?: (fraction: number) => void,
): Promise<CaptureResult> {
  const before = track.getSettings() as Record<string, unknown>;
  const restore: Record<string, unknown> = {};
  const brackets: Record<string, unknown>[] = [];
  const useComp = !!caps.exposureCompensation;
  if (useComp) {
    const r = caps.exposureCompensation!;
    const base = typeof before.exposureCompensation === "number" ? before.exposureCompensation : 0;
    for (const ev of [-2, 0, 2]) brackets.push({ exposureCompensation: Math.max(r.min, Math.min(r.max, base + ev)) });
    restore.exposureCompensation = base;
  } else if (caps.exposureTime && caps.exposureMode.includes("manual")) {
    const r = caps.exposureTime;
    if (typeof before.exposureTime !== "number") {
      throw new Error("HDR needs the current exposure time, which this camera does not report.");
    }
    const base = before.exposureTime;
    for (const k of [0.25, 1, 4]) {
      brackets.push({ exposureMode: "manual", exposureTime: Math.max(r.min, Math.min(r.max, base * k)) });
    }
    restore.exposureMode = before.exposureMode ?? "continuous";
    if (before.exposureMode === "manual") restore.exposureTime = base;
  } else {
    throw new Error("HDR bracketing is not supported by this camera.");
  }

  const frames: RgbaFrame[] = [];
  const key = useComp ? "exposureCompensation" : "exposureTime";
  try {
    for (let i = 0; i < brackets.length; i++) {
      await track.applyConstraints({ advanced: [brackets[i] as MediaTrackConstraintSet] });
      // Let the sensor settle on the new exposure (several frames).
      for (let k = 0; k < 6; k++) await nextVideoFrame(video);
      const reported = (track.getSettings() as Record<string, unknown>)[key];
      const wanted = brackets[i][key] as number;
      if (typeof reported !== "number" || Math.abs(reported - wanted) > Math.max(0.01, Math.abs(wanted) * 0.1)) {
        throw new Error("The camera did not apply the bracketed exposure, so HDR was cancelled.");
      }
      frames.push(readFrame(video));
      onProgress?.(((i + 1) / brackets.length) * 0.6);
    }
  } finally {
    try {
      await track.applyConstraints({ advanced: [restore as MediaTrackConstraintSet] });
    } catch {
      /* best effort */
    }
  }
  const fused = exposureFusion(frames);
  onProgress?.(0.9);
  const blob = await rgbaToBlob(fused, "image/png");
  onProgress?.(1);
  return {
    blob,
    width: fused.width,
    height: fused.height,
    method: "hdr-fusion",
    mimeType: "image/png",
    note: "HDR: 3 bracketed frames merged by exposure fusion",
  };
}

export const ASPECT_RATIOS = ["full", "4:3", "3:2", "16:9", "1:1"] as const;
export type AspectRatioChoice = (typeof ASPECT_RATIOS)[number];

export function aspectValue(choice: AspectRatioChoice): number | null {
  if (choice === "full") return null;
  const [a, b] = choice.split(":").map(Number);
  return a / b;
}

/**
 * Centered crop (normalized) giving `choice` in the image's orientation: a
 * portrait image with "16:9" yields a 9:16 portrait crop. Null = no crop.
 */
export function aspectCropRect(width: number, height: number, choice: AspectRatioChoice): CropRect | null {
  const target0 = aspectValue(choice);
  if (!target0 || !width || !height) return null;
  const portrait = height > width;
  const target = portrait && target0 !== 1 ? 1 / target0 : target0;
  const current = width / height;
  if (Math.abs(current - target) < 0.005) return null;
  if (current > target) {
    const w = target / current;
    return { x: (1 - w) / 2, y: 0, width: w, height: 1 };
  }
  const h = current / target;
  return { x: 0, y: (1 - h) / 2, width: 1, height: h };
}

export function captureFileName(date = new Date(), ext = "jpg"): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `PS_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(
    date.getSeconds(),
  )}.${ext}`;
}

export function extensionFor(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}
