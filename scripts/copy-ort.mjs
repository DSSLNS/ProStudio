// Copies the ONNX Runtime Web runtime (JS glue + WebAssembly, WebGPU/JSEP build)
// into public/wasm so it is served same-origin (the CSP allows no other origins).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
const src = "node_modules/onnxruntime-web/dist";
const files = ["ort.min.mjs", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"];
mkdirSync("public/wasm", { recursive: true });
for (const f of files) {
  if (!existsSync(`${src}/${f}`)) throw new Error(`onnxruntime-web is missing ${f}; run npm install`);
  copyFileSync(`${src}/${f}`, `public/wasm/${f}`);
}
console.log("[copy-ort] ONNX Runtime Web copied to public/wasm");

// LibRaw (WebAssembly) for RAW decoding — loaded at runtime from /wasm/libraw/.
const lr = "node_modules/libraw-wasm/dist";
mkdirSync("public/wasm/libraw", { recursive: true });
for (const f of ["index.js", "worker.js", "libraw.js", "libraw.wasm"]) {
  if (!existsSync(`${lr}/${f}`)) throw new Error(`libraw-wasm is missing ${f}; run npm install`);
  copyFileSync(`${lr}/${f}`, `public/wasm/libraw/${f}`);
}
console.log("[copy-ort] LibRaw copied to public/wasm/libraw");

// libheif (LGPL-3.0) for HEIC/HEIF where the browser can't decode natively — loaded at runtime
// as a separate, unmodified module (replaceable by users, per the LGPL).
const lh = "node_modules/libheif-js/libheif-wasm";
mkdirSync("public/wasm/libheif", { recursive: true });
for (const f of ["libheif-bundle.mjs", "LICENSE"]) {
  if (!existsSync(`${lh}/${f}`)) throw new Error(`libheif-js is missing ${f}; run npm install`);
  copyFileSync(`${lh}/${f}`, `public/wasm/libheif/${f}`);
}
console.log("[copy-ort] libheif copied to public/wasm/libheif");
