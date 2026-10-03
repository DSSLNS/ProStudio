/**
 * HEIC/HEIF fallback decoder (libheif WebAssembly in the pipeline worker),
 * used when the browser has no native HEIC support. Results are cached per
 * file for the session (import, preview and export decode the same blob).
 */
import type { HeicResponse } from "@/workers/heic.handler";

const cache = new WeakMap<Blob, Promise<{ rgba: Uint8ClampedArray<ArrayBuffer>; w: number; h: number }>>();

function decode(blob: Blob) {
  return new Promise<{ rgba: Uint8ClampedArray<ArrayBuffer>; w: number; h: number }>((resolve, reject) => {
    void blob.arrayBuffer().then((bytes) => {
      const worker = new Worker(new URL("../../workers/pipeline.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<HeicResponse>) => {
        worker.terminate();
        if (e.data.type === "done") resolve({ rgba: e.data.rgba as Uint8ClampedArray<ArrayBuffer>, w: e.data.w, h: e.data.h });
        else reject(new Error(e.data.message));
      };
      worker.onerror = (e) => {
        worker.terminate();
        reject(new Error(e.message || "The HEIC decoder crashed."));
      };
      worker.postMessage({ id: 1, kind: "heic", bytes }, [bytes]);
    }, reject);
  });
}

export async function decodeHeicWasm(blob: Blob): Promise<ImageBitmap> {
  let p = cache.get(blob);
  if (!p) {
    p = decode(blob);
    cache.set(blob, p);
    p.catch(() => cache.delete(blob));
  }
  const d = await p;
  return createImageBitmap(new ImageData(d.rgba, d.w, d.h), { premultiplyAlpha: "none" });
}
