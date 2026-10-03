/**
 * Feature detection for the browser/runtime. Everything here is a real probe —
 * nothing is assumed from the user agent.
 */

export interface BrowserCapabilities {
  mediaDevices: boolean;
  secureContext: boolean;
  imageCapture: boolean;
  faceDetector: boolean;
  webgl2: boolean;
  webgl2FloatRender: boolean;
  maxTextureSize: number;
  webgpu: boolean;
  wasm: boolean;
  wasmSimd: boolean;
  indexedDB: boolean;
  fileSystemAccess: boolean;
  offscreenCanvas: boolean;
  offscreenWebgl2: boolean;
  workers: boolean;
  serviceWorker: boolean;
  clipboardRead: boolean;
  deviceOrientation: boolean;
  deviceMemoryGB: number | null;
  hardwareConcurrency: number;
  encode: { webp: boolean; avif: boolean; jpeg: true; png: true };
}

let cached: Promise<BrowserCapabilities> | null = null;

export function getBrowserCapabilities(): Promise<BrowserCapabilities> {
  if (!cached) cached = detect();
  return cached;
}

/** WASM SIMD probe: a minimal module using v128 ops. */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

async function canEncode(type: string): Promise<boolean> {
  try {
    const c = document.createElement("canvas");
    c.width = 2;
    c.height = 2;
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type, 0.8));
    return !!blob && blob.type === type;
  } catch {
    return false;
  }
}

function probeWebgl2(): { ok: boolean; float: boolean; maxTex: number } {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (!gl) return { ok: false, float: false, maxTex: 0 };
    const float = !!gl.getExtension("EXT_color_buffer_float");
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { ok: true, float, maxTex };
  } catch {
    return { ok: false, float: false, maxTex: 0 };
  }
}

function probeOffscreenWebgl2(): boolean {
  try {
    if (typeof OffscreenCanvas === "undefined") return false;
    const gl = new OffscreenCanvas(1, 1).getContext("webgl2");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

async function detect(): Promise<BrowserCapabilities> {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    gpu?: { requestAdapter: () => Promise<unknown> };
  };
  const gl = probeWebgl2();
  let webgpu = false;
  if (nav.gpu) {
    try {
      webgpu = !!(await nav.gpu.requestAdapter());
    } catch {
      webgpu = false;
    }
  }
  const [webp, avif] = await Promise.all([canEncode("image/webp"), canEncode("image/avif")]);
  const wasm = typeof WebAssembly === "object";
  return {
    mediaDevices: !!nav.mediaDevices?.getUserMedia,
    secureContext: window.isSecureContext,
    imageCapture: typeof (window as unknown as { ImageCapture?: unknown }).ImageCapture === "function",
    faceDetector: typeof (window as unknown as { FaceDetector?: unknown }).FaceDetector === "function",
    webgl2: gl.ok,
    webgl2FloatRender: gl.float,
    maxTextureSize: gl.maxTex,
    webgpu,
    wasm,
    wasmSimd: wasm && WebAssembly.validate(SIMD_PROBE),
    indexedDB: typeof indexedDB !== "undefined",
    fileSystemAccess: "showSaveFilePicker" in window,
    offscreenCanvas: typeof OffscreenCanvas !== "undefined",
    offscreenWebgl2: probeOffscreenWebgl2(),
    workers: typeof Worker !== "undefined",
    serviceWorker: "serviceWorker" in navigator,
    clipboardRead: !!navigator.clipboard && "read" in navigator.clipboard,
    deviceOrientation: typeof DeviceOrientationEvent !== "undefined",
    deviceMemoryGB: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    hardwareConcurrency: navigator.hardwareConcurrency || 1,
    encode: { webp, avif, jpeg: true, png: true },
  };
}

/**
 * Rough memory budget (in pixels) for keeping a full-resolution decoded bitmap
 * around in the main thread. Used to decide whether to warn about very large images.
 */
export function fullResPixelBudget(caps: BrowserCapabilities): number {
  const gb = caps.deviceMemoryGB ?? 4;
  if (gb <= 2) return 24e6;
  if (gb <= 4) return 50e6;
  return 100e6;
}
