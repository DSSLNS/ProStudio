# Testing

## Unit (Vitest): `npm test`

Configured in `vitest.config.mts`; tests live in `tests/unit/`.

| Suite                        | Covers                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine/color.test.ts`       | sRGB transfer, HSV, black-body and white-balance gains, monotone curves, `.cube` parsing and sampling                                                                             |
| `engine/pipeline.test.ts`    | The default recipe is an identity (within 0.5/255); per-control behaviour; range safety at extreme settings; the HSL partition of unity; recipe normalisation for untrusted input |
| `engine/transform.test.ts`   | Orientation, flips, crop, preview scaling, homography, inscribed crop, tile bounds                                                                                                |
| `engine/cpuRenderer.test.ts` | Exact identity render, rotation, local adjustments                                                                                                                                |
| `engine/metadata.test.ts`    | EXIF orientation reset, GPS stripping, thumbnail removal, JPEG segment transplant                                                                                                 |
| `camera/*.test.ts`           | Frame analysis, exposure maths, `exposureTime` units, white balance, scene heuristics, capture helpers                                                                            |

## End to end (Playwright): `npm run build && npm run test:e2e`

The tests run against the **production** build, so the service worker is active. Chromium uses a fake camera (`--use-fake-device-for-media-stream`).

| Spec               | Covers                                                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `home`             | TAKE/EDIT PHOTO; no camera request on the homepage; non-image files rejected                                                                                                                                                                                                                |
| `editor`           | Import a 5000×3000 JPEG, apply +1 EV, export. Checks the export is **5000×3000** (not the 2560 px preview) and that a mid-grey patch brightened by about one stop. Also: undo/redo, history, rotate + 1:1 crop → 800×800 export, lossless PNG, split view, Auto Edit proposal, curve points |
| `projects`         | Save, reopen with edits kept, rename, duplicate, export `.prostudio`, delete, re-import                                                                                                                                                                                                     |
| `pwa`              | Manifest and icons, CSP headers, service-worker control, offline app shell                                                                                                                                                                                                                  |
| `camera`           | No `getUserMedia` call on the chooser; auto capture → review shows megapixels → editor; no aperture slider in manual mode                                                                                                                                                                   |
| `accessibility`    | axe (WCAG 2 A/AA) with no serious or critical violations on every route and in the editor workspace                                                                                                                                                                                         |
| `mobile` (Pixel 7) | Touch tool strip, bottom panel, panel switching                                                                                                                                                                                                                                             |

Image-quality checks compare dimensions, format signatures and mean colour of a region. They never compare lossy files byte for byte.

## Not covered automatically

- Real camera hardware controls (ISO, shutter, white balance) need a physical Android device. Fake devices don't expose them.
- Firefox and WebKit projects can be added to `playwright.config.ts`. Their camera fakes behave differently.

## Added in phases 1–11

**Unit tests:**

- `tests/unit/layers/*`: stack operations, validation, blend modes, adjustment maths, brush dabs, background eraser, spot-heal source search.
- `tests/unit/selection/*`: selection combination, magic wand, colour range, bounds.
- `tests/unit/ai/*`: tensors, resizing, guided filter, tiling, skin mask.
- `tests/unit/export/*`: sRGB ICC profile and EXIF writer, read back with the independent `exifr` parser.

**End-to-end tests** (all compare real exported pixels at full resolution):

| Spec        | Covers                                                                                                                                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layers`    | Blend modes, opacity, hiding, adjustment layers, image layers, reorder by buttons and drag-and-drop, persistence, `.prostudio` round-trip                                                                                                                |
| `masks`     | Hide-all and invert, painted masks, non-destructive eraser, gradient mask, paint layer with undo                                                                                                                                                         |
| `selection` | Rectangle with Delete, Shift/Alt combining, magic wand with invert, polygonal lasso, adjustment from selection, brush clipping, feather and crop to selection, full-resolution copy/paste                                                                |
| `brushes`   | Background eraser, pencil, synthetic pen pressure                                                                                                                                                                                                        |
| `retouch`   | Clone, heal (texture transferred, tone kept), spot heal, red-eye, dodge/burn, blur/sharpen, dust, smudge                                                                                                                                                 |
| `ai`        | **Real local inference**: background removal, object removal with Apply, sky, denoise, upscale to a new project, portrait. Also the model-missing path. The inference tests skip when `public/models` is absent; run `npm run models` first              |
| `raw`       | Generated Bayer DNG (checks demosaiced colours) and a corrupt RAW message. Optional real fixtures, skipped when missing: `tests/fixtures/example-sony.ARW` from the LibRaw-Wasm repository and `tests/fixtures/example.heic` from the libheif repository |
| `metadata`  | Keep all / remove location / remove all, sRGB ICC tag, fresh EXIF for RAW originals                                                                                                                                                                      |

Optional fixtures:

```bash
curl -L -o tests/fixtures/example-sony.ARW https://github.com/ybouane/LibRaw-Wasm/raw/main/example-sony.ARW
curl -L -o tests/fixtures/example.heic https://github.com/strukturag/libheif/raw/master/examples/example.heic
```

## Cross-browser

- Chromium always runs.
- Add browsers with `E2E_BROWSERS=webkit` (or `firefox`, or `all`), after `npx playwright install firefox webkit`.
- Camera tests need Chromium's fake device. On other engines they check graceful degradation.
- On the development machine (macOS 27), Playwright's Firefox build fails to launch ("Could not find profile folder"), both inside and outside the sandbox. Firefox therefore needs a Linux CI runner.

### Real bugs found by cross-browser testing (all fixed)

| Engine             | Problem                                                                                                                | Fix                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| WebKit / Safari    | `Blob`s cannot be stored in IndexedDB in ephemeral sessions (Private Browsing, automation), so **every import failed** | Assets and thumbnails are stored as `ArrayBuffer` + MIME type and rebuilt as Blobs on read. Legacy Blob records still load |
| WebKit / Safari 26 | WebGPU is exposed, but ONNX Runtime's WebGPU backend lacks `MaxPool(ceil_mode)`, so U²-Net failed at inference         | The AI worker retries on WebAssembly when a WebGPU run fails                                                               |
| WebKit             | The JPEG encoder writes its own minimal EXIF/ICC, which shadowed ProStudio's metadata                                  | Encoder-written EXIF/ICC segments are stripped before ours are inserted                                                    |
| WebKit             | LibRaw's full metadata call can fail                                                                                   | Falls back to LibRaw's basic metadata block                                                                                |

### Known harness limitations (not app bugs)

- **Playwright WebKit offline reload under a service worker:** reports "internal error". Service-worker install and control are still verified on WebKit; offline reload is verified on Chromium.
- **Firefox:** see above (cannot launch on macOS 27 in this environment).
