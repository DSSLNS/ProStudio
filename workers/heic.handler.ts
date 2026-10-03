/// <reference lib="webworker" />
/**
 * HEIC/HEIF decoding with libheif (WebAssembly), inside the pipeline worker so
 * the UI never blocks. Loaded at runtime from /wasm/libheif/ only when needed.
 */
export type HeicRequest = { id: number; kind: "heic"; bytes: ArrayBuffer };
export type HeicResponse =
  | { id: number; type: "done"; rgba: Uint8ClampedArray; w: number; h: number }
  | { id: number; type: "error"; message: string };

interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(img: { data: Uint8ClampedArray; width: number; height: number }, cb: (d: { data: Uint8ClampedArray } | null) => void): void;
}
interface LibHeif {
  HeifDecoder: new () => { decode(buf: Uint8Array): HeifImage[] };
}

let libPromise: Promise<LibHeif> | null = null;
function load(): Promise<LibHeif> {
  if (!libPromise) {
    libPromise = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "/wasm/libheif/libheif-bundle.mjs" as string).then(
      async (m: { default: () => LibHeif | Promise<LibHeif> }) => await m.default(),
    );
  }
  return libPromise;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

export async function handleHeic(r: HeicRequest) {
  try {
    const lib = await load();
    const images = new lib.HeifDecoder().decode(new Uint8Array(r.bytes));
    if (!images?.length) throw new Error("No image found in this HEIC/HEIF file.");
    // The primary image is the first; burst/sequence items are ignored.
    const img = images[0];
    const w = img.get_width();
    const h = img.get_height();
    const rgba = await new Promise<Uint8ClampedArray>((resolve, reject) =>
      img.display({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }, (d) => (d ? resolve(d.data) : reject(new Error("HEIF decode failed.")))),
    );
    ctx.postMessage({ id: r.id, type: "done", rgba, w, h } satisfies HeicResponse, [rgba.buffer]);
  } catch (e) {
    ctx.postMessage({ id: r.id, type: "error", message: (e as Error).message || "HEIF decode failed." } satisfies HeicResponse);
  }
}
