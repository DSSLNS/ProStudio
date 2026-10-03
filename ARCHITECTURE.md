# Architecture

## Principles

1. **The original is immutable.** Imported or captured bytes are stored as-is in IndexedDB (`assets` store) and are never re-encoded.
2. **Edits are data.** An `EditRecipe` (`types/edit.ts`) describes every adjustment. Rendering is always `render(original, recipe)`.
3. **The preview is disposable; export is authoritative.** The editor renders from a downscaled preview bitmap. Export decodes the original again at full resolution and renders it tile by tile.
4. **Nothing is faked.** Capabilities are detected (`lib/browserCapabilities.ts`, `camera/capabilities.ts`). Unsupported features are hidden or explained, and software alternatives are labelled as software.

## Data flow

```
File / camera blob
  └─ sniffFormat (magic bytes) ─ createProjectFromFile ─► IndexedDB: assets + projects
Editor open
  └─ decode preview (≤ N px per performance mode) ─► WebGLRenderer.setSource
Slider drag ─► editorStore.updateRecipe (live) ─► rAF render
Slider release ─► editorStore.commit(label) ─► historyStore.push (recipe snapshot)
Auto-save (debounced) ─► saveProjectState (recipe, layers, history, thumbnail)
Export ─► decode original (full res) ─► export worker: tiles ─► OffscreenCanvas ─► encode ─► metadata ─► save
```

## State (Zustand)

| Store                         | Contents                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `uiStore`                     | Persisted preferences (small JSON in localStorage)                                                                                  |
| `editorStore`                 | Open project, source blob, preview bitmap, recipe, layers, tool, panel, compare mode, zoom and pan                                  |
| `historyStore`                | Up to 200 `{label, recipe, layers}` snapshots and the current index                                                                 |
| `cameraStore`                 | Devices, capabilities, settings, overlays, analysis, capture state                                                                  |
| `components/editor/viewState` | Values that change at pointer rate (cursor colour, crop draft, render info), kept separate so they don't cause re-renders elsewhere |

Components subscribe with narrow selectors. The canvas renders through refs (`editorRuntime`), not React state.

## Storage (IndexedDB `prostudio` v1)

`assets` (immutable binary data, stored as ArrayBuffer + MIME type because WebKit cannot store Blobs in IndexedDB in ephemeral sessions), `projects` (metadata, recipe, layers), `history`, `thumbnails`, `luts` (parsed Float32 cube data), `presets`.

The `.prostudio` file is a ZIP. `project.json` comes first so the file can be recognised from its content, followed by `assets/<id>` stored without compression. Import validates and re-keys every field and asset, and nothing in the file is ever executed.

## Security

- A static CSP (`next.config.ts`) with `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'` and no third-party origins. A nonce-based CSP would need per-request rendering, which conflicts with serving the pages offline from the service worker.
- File type comes from magic bytes, never from the extension or the reported MIME type. There are size caps (512 MB file, about 268 MP decode).
- SVG is rendered only through `<img>`, where scripts never run.
- `.cube` and `.prostudio` parsers validate counts and types and bound sizes.

## Pipeline stages and module mapping

| Stage                                                | Module                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| Decode and colour management                         | `lib/fileUtils.ts` (`createImageBitmap`, converted to sRGB), `engine/raw/`   |
| Base, tone and colour adjustments                    | `engine/color/pipeline.ts` (CPU reference) and `engine/gl/shaders.ts` (GPU)  |
| Local detail (clarity, texture, sharpen, NR, dehaze) | Blurred feature maps: `WebGLRenderer.blur`, `engine/filters/blur.ts`         |
| Transform                                            | `engine/image/transform.ts`                                                  |
| Export                                               | `engine/render/renderFull.ts`, `engine/export/*`, `workers/export.worker.ts` |
| Layers, masks, AI                                    | Planned; see the README roadmap                                              |

## Layers, masks, tools and AI (phases 1–7)

| Concern                                                               | Where                                                                             |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Layer and mask model, validation, asset references                    | `types/layers.ts`                                                                 |
| Stack operations (insert, move, group, duplicate, …)                  | `engine/layers/layerOps.ts`                                                       |
| Rasterisers (text, shape, image, paint, masks) and incremental caches | `engine/layers/raster.ts`                                                         |
| GPU compositor and retouch renderer                                   | `engine/gl/Compositor.ts`, `engine/gl/RetouchRenderer.ts`                         |
| CPU compositor                                                        | `engine/layers/cpuCompositor.ts`                                                  |
| Selections                                                            | `engine/selection/selection.ts`, `components/editor/selection/*`                  |
| Brushes and stroke routing                                            | `engine/layers/dabs.ts`, `components/editor/tools/*`                              |
| AI                                                                    | `engine/ai/*`, `workers/ai.worker.ts`, `components/editor/ai/*`, `ai/models.json` |
| RAW and HEIC                                                          | `engine/raw/libraw.ts`, `engine/heic/decodeHeic.ts`, `workers/heic.handler.ts`    |

**Workers.** `workers/pipeline.worker.ts` is the single worker entry. It dispatches export, AI and HEIC jobs by message shape; a single entry avoids bundler worker-chunk mix-ups. Third-party runtimes (ONNX Runtime, LibRaw, libheif) are copied into `public/wasm/` and imported at runtime from the same origin, so the bundler never touches them.

**History.** Each history entry holds `{recipe (cloned), layers (shared references)}`. Operation lists are append-only and immutable, so a 200-step history does not duplicate brush strokes. IndexedDB's structured clone preserves the sharing. `.prostudio` v2 files store each distinct layer object once in a `layerTable`; v1 files still import.

**Security.**

- The page CSP is unchanged: no `unsafe-eval`, no third-party origins.
- Only the sandboxed LibRaw worker (`/wasm/libraw/*`) receives `unsafe-eval` through its own response CSP, because its Emscripten glue requires it.
- COOP/COEP headers make the page cross-origin isolated, which enables multi-threaded WebAssembly for AI.
- Imported layer data is validated field by field (`normalizeLayer`/`normalizeMask`), with bounded op and point counts.
