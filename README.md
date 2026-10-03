# ProStudio

A free, private, installable professional camera and non-destructive photo editor that runs entirely in the browser. It has no account, no watermark and no uploads: photos are processed and stored only on your device.

> **Status:** all planned capabilities are implemented and tested: camera, editor, layers, masks, selections, brushes, retouching, local AI, RAW, colour tagging, HEIC, metadata and PWA. See [Roadmap](#roadmap) for what remains.

## What works today

| Area                    | Implemented                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PWA**                 | Manifest, icons, screenshots, shortcuts, a versioned service worker that keeps the app shell available offline, an update prompt, an install prompt, and an offline indicator                                                                                                                                                                                                                                            |
| **Home**                | TAKE PHOTO and EDIT PHOTO, recent projects, new project, open project, settings                                                                                                                                                                                                                                                                                                                                          |
| **Camera**              | Device and capability detection, a permission flow with clear errors, and Auto and Manual modes driving real `MediaStreamTrack` constraints that are checked with `getSettings()` after they are applied. Overlays: histogram, EV meter, grid, level, zebra, clipping and focus peaking. Capture: timer, burst, HDR exposure bracketing, multi-frame night mode, and capture → review → edit. See [CAMERA.md](CAMERA.md) |
| **Import**              | File picker, drag and drop, paste, multiple files. File type is detected from magic bytes. Formats: JPEG, PNG, WebP, AVIF, GIF, BMP, TIFF, SVG (rendered safely as an image), HEIC/HEIF, and RAW                                                                                                                                                                                                                         |
| **Engine**              | A non-destructive recipe on a WebGL2 GPU pipeline, with a CPU fallback that runs the same maths. A single projective resample handles all geometry. Export is tiled and rendered at full resolution from the original. See [IMAGE_ENGINE.md](IMAGE_ENGINE.md)                                                                                                                                                            |
| **Editing**             | Crop with presets, rotate, flip, straighten with auto-constrain, perspective, skew and scale                                                                                                                                                                                                                                                                                                                             |
| **Light and colour**    | Exposure, contrast, highlights, shadows, whites, blacks, brightness, gamma, clarity, texture and dehaze. White balance (temperature and tint), vibrance, saturation, hue, an 8-band HSL mixer, three-way colour grading and split toning, colour balance, RGB/R/G/B curves, and `.cube` 3D LUTs with an intensity control                                                                                                |
| **Detail and effects**  | Sharpening, luminance and colour noise reduction, post-crop vignette, grain                                                                                                                                                                                                                                                                                                                                              |
| **Auto Edit**           | An image-statistics algorithm (not a neural network). It proposes adjustments with an intensity control and you choose Apply or Cancel                                                                                                                                                                                                                                                                                   |
| **Layers**              | Image, text, shape, adjustment, group, paint and retouch layers. Visibility, lock, duplicate, delete, rename, drag-and-drop reordering, opacity, thumbnails, and 11 blend modes on the GPU (with a CPU fallback). Move and resize on the canvas                                                                                                                                                                          |
| **Masks**               | Reveal-all, hide-all or from a selection. Paint to reveal or hide (X swaps), eraser, invert, non-destructive feather, gradient masks, mask ↔ selection, and a mask preview                                                                                                                                                                                                                                               |
| **Selections**          | Rectangle, ellipse, lasso, polygonal lasso, magic wand, colour range, selection brush, and AI subject/sky selection. Add, subtract or intersect (Shift/Alt). Invert, feather, expand, contract. Selections clip brushes. Delete hides selected pixels non-destructively. Full-resolution copy/paste, crop to selection, adjustment layer from selection                                                                  |
| **Brushes**             | Brush, pencil, eraser (non-destructive on non-paint layers), background eraser, and soft/hard presets. Size, hardness, opacity, flow, spacing and smoothing. Pen pressure, plus mouse and touch                                                                                                                                                                                                                          |
| **Retouching**          | Clone stamp (aligned or non-aligned), healing brush, spot healing and blemish removal (automatic source), dust & scratches, red-eye, dodge, burn, smudge, blur and sharpen brushes. All are GPU operations on a retouch layer and never destructive                                                                                                                                                                      |
| **AI (local)**          | Background removal, subject and sky selection or adjustment, object removal (inpainting), AI denoise, AI upscale 2×/4× into a new project, portrait skin and tone, and AI-assisted Auto Edit. Models load lazily and run via ONNX Runtime Web (WebGPU or WASM). See [AI.md](AI.md)                                                                                                                                       |
| **RAW**                 | DNG, CR2, CR3, NEF, ARW and RAF via LibRaw (WebAssembly): demosaic, camera white balance, highlight recovery and sRGB. The original RAW is kept untouched, and metadata comes from LibRaw                                                                                                                                                                                                                                |
| **HEIC/HEIF**           | Native decoding where the browser supports it; otherwise libheif (WebAssembly), lazy-loaded in a worker                                                                                                                                                                                                                                                                                                                  |
| **Metadata and colour** | Keep all, remove location, or remove all. JPEG EXIF is copied; other originals get fresh EXIF. Exports are tagged with an sRGB ICC profile, with a wide-gamut source warning                                                                                                                                                                                                                                             |
| **Workflow**            | Undo and redo with a history list (stores settings snapshots, never pixels), before/after split and side-by-side views, hold to see the original, keyboard shortcuts with a reference panel, presets, and copy/paste of settings                                                                                                                                                                                         |
| **Projects**            | Stored in IndexedDB with auto-save. Save, open, rename, duplicate and delete. Import and export as `.prostudio` files                                                                                                                                                                                                                                                                                                    |
| **Export**              | JPEG, PNG, WebP and AVIF (where the browser can encode them), and lossless TIFF. Quality and resize controls. EXIF is carried over with orientation fixed and the thumbnail removed, and GPS can optionally be stripped. Progress is shown and the work runs in a worker                                                                                                                                                 |
| **Mobile**              | Touch tool strip, a bottom panel you can swipe, pinch zoom, large touch targets                                                                                                                                                                                                                                                                                                                                          |
| **Settings**            | Theme (dark, light or system), high contrast, export defaults, metadata and privacy, performance mode, GPU on/off, camera defaults, and a report of this device's capabilities                                                                                                                                                                                                                                           |

## Setup

```bash
npm install
npx playwright install chromium   # for e2e tests / icon generation
npm run models                    # optional: download and verify the local AI models (~290 MB)
npm run dev                       # http://localhost:3000 (service worker disabled in dev)
```

The camera requires a **secure context**: either `localhost` or HTTPS.

## Scripts

| Command                                                 | Purpose                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run dev`                                           | Dev server. Set `NEXT_PUBLIC_ENABLE_SW_IN_DEV=1` to test the service worker              |
| `npm run build`                                         | Stamps the service worker cache version (`scripts/build-sw.mjs`), then runs `next build` |
| `npm start`                                             | Serves the production build                                                              |
| `npm run typecheck` / `npm run lint` / `npm run format` | Type checking, linting and formatting                                                    |
| `npm test`                                              | Unit tests (Vitest): engine maths, geometry, metadata and camera analysis                |
| `npm run test:e2e`                                      | Playwright end-to-end tests against the production build (run `npm run build` first)     |
| `npm run icons`                                         | Regenerates the PNG icons from `public/icons/icon.svg`                                   |
| `npm run models`                                        | Downloads the AI models into `public/models/` and verifies their SHA-256                 |
| `E2E_BROWSERS=webkit npm run test:e2e`                  | Also runs WebKit (or `firefox`, or `all`)                                                |

## Project layout

```
app/            routes: / camera/{,auto,manual} editor projects settings, manifest.ts
components/     app/ (shell, providers), camera/, editor/, projects/, ui/ (shadcn/Base UI)
camera/         capabilities, device manager, frame analysis, AutoCameraEngine, capture, multi-frame
engine/         color/ (maths, pipeline, curves, LUT), image/ (geometry), gl/ (WebGL2 renderer + shaders),
                cpu/ (fallback renderer), filters/, render/ (tiled full-res), export/, analysis/, raw/
workers/        export.worker.ts
storage/        IndexedDB schema, projects, assets, .prostudio files
store/          Zustand: ui (persisted prefs), editor, history, camera
hooks/ lib/     import, project loading/saving, shortcuts; capabilities, file sniffing, metadata
tests/          unit/ (Vitest), e2e/ (Playwright)
```

Further documentation: [ARCHITECTURE.md](ARCHITECTURE.md), [CAMERA.md](CAMERA.md), [IMAGE_ENGINE.md](IMAGE_ENGINE.md), [AI.md](AI.md), [PWA.md](PWA.md), [TESTING.md](TESTING.md).

## Browser limitations (by design, never faked)

- **Camera hardware:** ISO, shutter speed, focus distance, colour temperature, zoom, torch and flash appear only when the browser reports them. Desktop browsers and iOS Safari usually expose very few of these; Android Chrome exposes the most. Physical aperture has no web API. RAW sensor capture is not available on the web.
- **HEIC:** Safari decodes it natively; other browsers use the bundled libheif WebAssembly decoder.
- **Colour:** the pipeline is sRGB. Wide-gamut originals are converted, and a warning is shown on export. Exports are tagged with an sRGB ICC profile; the original's wide-gamut profile is never attached to converted pixels.
- **Metadata:** written to JPEG and PNG exports. WebP, AVIF and TIFF exports contain no metadata.
- **Very large images:** the output must fit in a single canvas (about 268 MP on desktop Chrome, much less on iOS). The preview is downscaled to suit the selected performance mode, and export always uses the original.

## Deployment

The app is fully static. Deploy the `next build` output to any Node host (`npm start`) or to a platform such as Vercel. Make sure that:

- the site is served over HTTPS (required for the camera and the service worker);
- `/sw.js` is served with `Cache-Control: no-cache` (set in `next.config.ts`);
- the security headers in `next.config.ts` are kept. If a platform overrides headers, copy the CSP across.

No environment variables are required (see `.env.example`).

## Roadmap

These items are not done yet:

1. **Wide-gamut pipeline.** Display P3 preview and export: a float16 pipeline with `drawingBufferColorSpace` and P3 canvases. Exports are sRGB today.
2. **Lens correction profiles.** No lens database is available in the browser.
3. **RAW decode options.** Expose white balance, highlight mode and demosaic in the UI (fixed defaults today). Also a 16-bit RAW path.
4. **Full-resolution segmentation masks** for very large images. Masks are preview resolution today.
5. **WebGPU image pipeline.** WebGPU is only used by AI today.
6. **Firefox automated tests.** Playwright's Firefox build fails to launch on the development machine (macOS 27). Run `E2E_BROWSERS=firefox` on Linux CI.
