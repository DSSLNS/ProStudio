/**
 * Camera device management: enumeration, opening/stopping streams, friendly
 * error messages, and permission state. Never requests permission on its own —
 * callers decide when (only on camera pages / explicit button clicks).
 */

export interface VideoDevice {
  deviceId: string;
  /** Empty until the user grants camera permission (browser privacy rule). */
  label: string;
  groupId: string;
}

export type Facing = "environment" | "user";
export type PermissionStateExt = "granted" | "denied" | "prompt" | "unknown";

export interface OpenOptions {
  deviceId?: string | null;
  facing?: Facing;
  width?: number;
  height?: number;
}

export interface CameraErrorInfo {
  code: "denied" | "not-found" | "in-use" | "overconstrained" | "insecure" | "unsupported" | "aborted" | "unknown";
  message: string;
  retryable: boolean;
}

export function isCameraApiAvailable(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export async function listVideoDevices(): Promise<VideoDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === "videoinput")
    .map((d) => ({ deviceId: d.deviceId, label: d.label, groupId: d.groupId }));
}

/** True once labels are exposed, i.e. the user granted permission at some point this session. */
export const hasDeviceLabels = (devices: VideoDevice[]): boolean => devices.some((d) => d.label !== "");

export function buildConstraints(opts: OpenOptions): MediaStreamConstraints {
  const video: MediaTrackConstraints = {};
  if (opts.deviceId) video.deviceId = { exact: opts.deviceId };
  else if (opts.facing) video.facingMode = { ideal: opts.facing };
  if (opts.width) video.width = { ideal: opts.width };
  if (opts.height) video.height = { ideal: opts.height };
  return { video, audio: false };
}

/** Resolutions tried, in order, when a requested resolution is rejected (OverconstrainedError). */
export const FALLBACK_RESOLUTIONS: { width: number; height: number }[] = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 640, height: 480 },
];

/**
 * Open a camera stream. If the request is over-constrained, retries with
 * progressively lower resolutions and finally with no resolution at all.
 */
export async function openStream(opts: OpenOptions): Promise<{ stream: MediaStream; downgraded: boolean }> {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw Object.assign(new Error("insecure"), { name: "SecurityError" });
  }
  if (!isCameraApiAvailable()) {
    throw Object.assign(new Error("getUserMedia unavailable"), { name: "NotSupportedError" });
  }
  try {
    return { stream: await navigator.mediaDevices.getUserMedia(buildConstraints(opts)), downgraded: false };
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name !== "OverconstrainedError" && name !== "ConstraintNotSatisfiedError") throw e;
    const smaller = FALLBACK_RESOLUTIONS.filter((r) => !opts.width || r.width < opts.width);
    for (const r of [...smaller, null]) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(
          buildConstraints({ ...opts, width: r?.width, height: r?.height }),
        );
        return { stream, downgraded: true };
      } catch (err) {
        const n = (err as DOMException)?.name;
        if (n !== "OverconstrainedError" && n !== "ConstraintNotSatisfiedError") throw err;
      }
    }
    throw e;
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Map getUserMedia errors to friendly, actionable messages. */
export function describeCameraError(e: unknown): CameraErrorInfo {
  const name = (e as { name?: string })?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return {
        code: "denied",
        message: "Camera access was denied. Please enable camera permission in your browser settings.",
        retryable: true,
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return { code: "not-found", message: "No camera was found on this device.", retryable: true };
    case "NotReadableError":
    case "TrackStartError":
      return {
        code: "in-use",
        message:
          "The camera is in use by another app or tab, or could not be started. Close other apps using the camera and try again.",
        retryable: true,
      };
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return {
        code: "overconstrained",
        message: "This camera does not support the requested resolution. Try a lower resolution.",
        retryable: true,
      };
    case "SecurityError":
      return {
        code: "insecure",
        message: "Camera access requires a secure connection (HTTPS or localhost).",
        retryable: false,
      };
    case "NotSupportedError":
    case "TypeError":
      return { code: "unsupported", message: "This browser does not support camera access.", retryable: false };
    case "AbortError":
      return { code: "aborted", message: "Starting the camera was interrupted. Please try again.", retryable: true };
    default:
      return { code: "unknown", message: "The camera could not be started. Please try again.", retryable: true };
  }
}

/** Camera permission via the Permissions API, where supported (not in all browsers). */
export async function queryCameraPermission(): Promise<PermissionStateExt> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
    const status = await navigator.permissions.query({ name: "camera" as PermissionName });
    return status.state;
  } catch {
    return "unknown";
  }
}

/** Subscribe to permission changes; returns an unsubscribe function. */
export async function watchCameraPermission(cb: (s: PermissionStateExt) => void): Promise<() => void> {
  try {
    if (!navigator.permissions?.query) return () => {};
    const status = await navigator.permissions.query({ name: "camera" as PermissionName });
    const handler = () => cb(status.state);
    status.addEventListener("change", handler);
    return () => status.removeEventListener("change", handler);
  } catch {
    return () => {};
  }
}

/** Request permission explicitly (button click): opens and immediately closes a stream so labels become visible. */
export async function requestCameraPermission(): Promise<VideoDevice[]> {
  const { stream } = await openStream({});
  stopStream(stream);
  return listVideoDevices();
}

/** Best-effort facing guess from a device label (labels like "Back Camera", "front", "FaceTime"). */
export function guessFacingFromLabel(label: string): Facing | null {
  const l = label.toLowerCase();
  if (/back|rear|environment|world/.test(l)) return "environment";
  if (/front|user|facetime|selfie/.test(l)) return "user";
  return null;
}
