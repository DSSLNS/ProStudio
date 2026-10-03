/// <reference lib="webworker" />
/**
 * AI job handler (runs inside workers/pipeline.worker.ts): runs ONNX models locally with ONNX Runtime Web (WebGPU when
 * available, WebAssembly otherwise). Images never leave the device.
 * The runtime and models are loaded lazily, same-origin, on first use.
 */
import type * as OrtNs from "onnxruntime-web";
import manifest from "@/ai/models.json";
import {
  guidedFilter,
  IMAGENET_MEAN,
  IMAGENET_STD,
  lumaOf,
  minMaxNormalize,
  planTiles,
  resizeMap,
  toCHW,
} from "@/engine/ai/imageOps";

type Ort = typeof OrtNs;
export type ModelId = keyof typeof manifest;

export type AiRequest =
  | { id: number; type: "segment"; model: "u2netp" | "skyseg"; rgba: Uint8ClampedArray; w: number; h: number; refine: number }
  | { id: number; type: "inpaint"; rgba: Uint8ClampedArray; mask: Uint8Array; w: number; h: number }
  | { id: number; type: "denoise"; rgba: Uint8ClampedArray; w: number; h: number }
  | { id: number; type: "upscale"; rgba: Uint8ClampedArray; w: number; h: number; factor: 2 | 4 };

export type AiResponse =
  | { id: number; type: "progress"; fraction: number; message: string }
  | { id: number; type: "done"; mask?: Uint8Array; rgba?: Uint8ClampedArray; w: number; h: number; backend: string }
  | { id: number; type: "error"; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let ortPromise: Promise<Ort> | null = null;
const sessions = new Map<string, { session: OrtNs.InferenceSession; backend: string }>();

function loadOrt(): Promise<Ort> {
  if (!ortPromise) {
    ortPromise = (async () => {
      const ort = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "/wasm/ort.min.mjs" as string)) as Ort;
      ort.env.wasm.wasmPaths = "/wasm/";
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      return ort;
    })();
  }
  return ortPromise;
}

async function fetchWithProgress(url: string, onProgress: (f: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status === 404 ? "MODEL_NOT_INSTALLED" : `Model download failed (${res.status}).`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader();
  const out = new Uint8Array(total);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, got);
    got += value.length;
    onProgress(got / total);
  }
  return out.buffer;
}

async function session(id: ModelId, reqId: number, forceWasm = false): Promise<{ session: OrtNs.InferenceSession; backend: string }> {
  const cached = sessions.get(id);
  if (cached && !(forceWasm && cached.backend === "WebGPU")) return cached;
  const ort = await loadOrt();
  const m = manifest[id];
  const total = m.files.reduce((a, f) => a + f.bytes, 0);
  let loaded = 0;
  const buffers: ArrayBuffer[] = [];
  for (const f of m.files) {
    const buf = await fetchWithProgress(`/models/${id}/${f.name}`, (p) =>
      progress(reqId, (0.4 * (loaded + p * f.bytes)) / total, `Preparing AI model… ${((loaded + p * f.bytes) / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`),
    );
    loaded += f.bytes;
    buffers.push(buf);
  }
  const [model, ...data] = buffers;
  const externalData = data.map((d, i) => ({ path: m.files[i + 1].name, data: new Uint8Array(d) }));
  const gpu = "gpu" in navigator && !forceWasm;
  for (const ep of gpu ? ["webgpu", "wasm"] : ["wasm"]) {
    try {
      const s = await ort.InferenceSession.create(new Uint8Array(model), {
        executionProviders: [ep],
        graphOptimizationLevel: "all",
        ...(externalData.length ? { externalData } : {}),
      });
      const entry = { session: s, backend: ep === "webgpu" ? "WebGPU" : "WebAssembly (CPU)" };
      sessions.set(id, entry);
      return entry;
    } catch (e) {
      if (ep === "wasm") throw e;
    }
  }
  throw new Error("No execution provider available.");
}

/**
 * Run a model, falling back to WebAssembly if WebGPU fails at inference time
 * (some ONNX operators are not implemented in the WebGPU backend, e.g. MaxPool
 * with ceil_mode in Safari) — results are identical, just slower.
 */
async function infer(id: ModelId, reqId: number, feeds: Record<string, OrtNs.Tensor>) {
  let e = await session(id, reqId);
  try {
    return { out: await e.session.run(feeds), session: e.session, backend: e.backend };
  } catch (err) {
    if (e.backend !== "WebGPU") throw err;
    e = await session(id, reqId, true);
    return { out: await e.session.run(feeds), session: e.session, backend: e.backend };
  }
}

function progress(id: number, fraction: number, message: string) {
  ctx.postMessage({ id, type: "progress", fraction, message } satisfies AiResponse);
}

async function segment(r: Extract<AiRequest, { type: "segment" }>) {
  const first = await session(r.model, r.id);
  const ort = await loadOrt();
  progress(r.id, 0.5, "Analysing image…");
  const input = toCHW(r.rgba, r.w, r.h, 320, 320, { mean: IMAGENET_MEAN, std: IMAGENET_STD });
  const { out, session: s, backend } = await infer(r.model, r.id, { [first.session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, 320, 320]) });
  const prob = minMaxNormalize(out[s.outputNames[0]].data as Float32Array);
  progress(r.id, 0.8, "Refining edges…");
  let mask = resizeMap(prob, 320, 320, r.w, r.h);
  if (r.refine > 0) {
    // Edge refinement: guided filter with the image as guide (helps hair/fur edges).
    const radius = Math.max(2, Math.round((Math.max(r.w, r.h) / 320) * r.refine));
    mask = guidedFilter(lumaOf(r.rgba, r.w, r.h), mask, r.w, r.h, radius, 1e-3);
  }
  const bytes = new Uint8Array(r.w * r.h);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(Math.max(0, Math.min(1, mask[i])) * 255);
  return { mask: bytes, w: r.w, h: r.h, backend };
}

async function inpaint(r: Extract<AiRequest, { type: "inpaint" }>) {
  const ort = await loadOrt();
  progress(r.id, 0.5, "Filling the removed area…");
  const n = r.w * r.h;
  const img = new Uint8Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) img[c * n + i] = r.rgba[i * 4 + c];
  // MI-GAN convention: 0 = area to fill, 255 = keep.
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = r.mask[i] > 127 ? 0 : 255;
  const { out, session: s, backend } = await infer("migan", r.id, {
    image: new ort.Tensor("uint8", img, [1, 3, r.h, r.w]),
    mask: new ort.Tensor("uint8", mask, [1, 1, r.h, r.w]),
  });
  const res = out[s.outputNames[0]].data as Uint8Array;
  const rgba = new Uint8ClampedArray(4 * n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = res[c * n + i];
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, w: r.w, h: r.h, backend };
}

/**
 * Run a float RGB(0..1) model over overlapping tiles. Each tile contributes only
 * its core (overlap discarded), written straight into an 8-bit output — memory is
 * bounded by the output image, not a float accumulator. `outScale` < model scale
 * downsamples each tile's output (e.g. a ×4 model used for ×2).
 */
async function tiled(
  reqId: number,
  model: ModelId,
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  tile: number,
  overlap: number,
  modelScale: number,
  outScale: number,
  fixedTile: boolean,
  label: string,
  /** Input dimensions must be multiples of this (e.g. SCUNet's windowed attention needs 64); tiles are edge-padded. */
  multiple = 1,
) {
  let { session: s, backend } = await session(model, reqId);
  const ort = await loadOrt();
  const W = w * outScale;
  const H = h * outScale;
  const out8 = new Uint8ClampedArray(W * H * 4);
  const tiles = planTiles(w, h, tile, overlap);
  const ds = modelScale / outScale;
  for (let k = 0; k < tiles.length; k++) {
    const t = tiles[k];
    progress(reqId, 0.4 + (0.6 * k) / tiles.length, `${label} — tile ${k + 1} of ${tiles.length}`);
    const tw = fixedTile ? tile : Math.ceil(t.w / multiple) * multiple;
    const th = fixedTile ? tile : Math.ceil(t.h / multiple) * multiple;
    const input = new Float32Array(3 * tw * th);
    for (let y = 0; y < th; y++)
      for (let x = 0; x < tw; x++) {
        const sx = Math.min(w - 1, t.x + x);
        const sy = Math.min(h - 1, t.y + y);
        for (let c = 0; c < 3; c++) input[c * tw * th + y * tw + x] = rgba[(sy * w + sx) * 4 + c] / 255;
      }
    const r = await infer(model, reqId, { [s.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, th, tw]) });
    const res = r.out;
    s = r.session;
    backend = r.backend;
    const o = res[s.outputNames[0]].data as Float32Array;
    const ow = tw * modelScale;
    const oh = th * modelScale;
    // Core region in input px: drop the overlap on sides that border another tile.
    const cx0 = t.x === 0 ? 0 : overlap;
    const cy0 = t.y === 0 ? 0 : overlap;
    const cx1 = t.x + t.w >= w ? t.w : t.w - overlap;
    const cy1 = t.y + t.h >= h ? t.h : t.h - overlap;
    for (let y = cy0 * outScale; y < cy1 * outScale; y++)
      for (let x = cx0 * outScale; x < cx1 * outScale; x++) {
        const di = ((t.y * outScale + y) * W + t.x * outScale + x) * 4;
        for (let c = 0; c < 3; c++) {
          let v = 0;
          for (let yy = 0; yy < ds; yy++) for (let xx = 0; xx < ds; xx++) v += o[c * ow * oh + (y * ds + yy) * ow + x * ds + xx];
          out8[di + c] = Math.round(Math.max(0, Math.min(1, v / (ds * ds))) * 255);
        }
        const sx = Math.min(w - 1, Math.floor((t.x * outScale + x) / outScale));
        const sy = Math.min(h - 1, Math.floor((t.y * outScale + y) / outScale));
        out8[di + 3] = rgba[(sy * w + sx) * 4 + 3];
      }
  }
  return { rgba: out8, w: W, h: H, backend };
}

export async function handleAi(r: AiRequest) {
  try {
    let res: { mask?: Uint8Array; rgba?: Uint8ClampedArray; w: number; h: number; backend: string };
    if (r.type === "segment") res = await segment(r);
    else if (r.type === "inpaint") res = await inpaint(r);
    else if (r.type === "denoise") res = await tiled(r.id, "scunet", r.rgba, r.w, r.h, 256, 16, 1, 1, false, "Denoising", 64);
    else res = await tiled(r.id, "esrgan", r.rgba, r.w, r.h, 128, 12, 4, r.factor, true, "Upscaling");
    const transfer: Transferable[] = [];
    if (res.mask) transfer.push(res.mask.buffer);
    if (res.rgba) transfer.push(res.rgba.buffer);
    ctx.postMessage({ id: r.id, type: "done", ...res } satisfies AiResponse, transfer);
  } catch (err) {
    const msg = (err as Error).message || String(err);
    ctx.postMessage({ id: r.id, type: "error", message: msg } satisfies AiResponse);
  }
}
