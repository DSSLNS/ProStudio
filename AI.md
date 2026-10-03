# AI features

All AI runs **on the device**, in a Web Worker, with [ONNX Runtime Web](https://onnxruntime.ai/).

- **Execution provider:** WebGPU is used where available; otherwise WebAssembly (multi-threaded when the page is cross-origin isolated).
- **Privacy:** images are never uploaded.
- **Loading:** nothing AI-related loads at app start. The runtime (`/wasm/ort.min.mjs` and its wasm) and each model download only when you first use the feature that needs them. The service worker then caches them (`prostudio-models-v1`) for offline use.

## Models

The list lives in `ai/models.json`, with the source URL, SHA-256, size and licence of each file.

Models are **not** committed to the repository. Install them on the server with:

```bash
npm run models            # all models (~290 MB)
npm run models -- u2netp  # just one
```

The script downloads each model to `public/models/<id>/` and verifies its checksum. Features whose model is missing are disabled, with an explanation in the AI panel.

| Id       | Model                                | Licence      | Size   | Used for                                                                                  |
| -------- | ------------------------------------ | ------------ | ------ | ----------------------------------------------------------------------------------------- |
| `u2netp` | U²-Net-p salient-object segmentation | Apache-2.0   | 4.6 MB | Select subject, remove background, adjust subject/background, portrait mask, AI Auto Edit |
| `skyseg` | Sky segmentation (U²-Net)            | MIT          | 176 MB | Sky selection and adjustments                                                             |
| `migan`  | MI-GAN inpainting (pipeline v2)      | MIT          | 28 MB  | Object removal                                                                            |
| `scunet` | SCUNet colour denoising (σ = 25)     | Apache-2.0   | 77 MB  | AI denoise                                                                                |
| `esrgan` | Real-ESRGAN General x4v3             | BSD-3-Clause | 5 MB   | AI upscale 2× / 4×                                                                        |

The runtime is copied into `public/wasm/` by `scripts/copy-ort.mjs`, which runs on `dev` and `build`.

## Features

All of these are in **Editor → AI panel**.

| Feature                     | What it produces (all non-destructive)                                                                                   | Notes                                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Select subject              | A raster selection op                                                                                                    | Uses the main _salient_ subject. The model does **not** classify it as person, animal, vehicle or product.                                                                                                       |
| Remove background           | A mask on the photo layer                                                                                                | Optional guided-filter edge refinement improves hair and fur edges.                                                                                                                                              |
| Adjust subject / background | An adjustment layer masked to the subject, or to its inverse                                                             |                                                                                                                                                                                                                  |
| Sky (adjust / select)       | A "Sky" adjustment layer for exposure, temperature, saturation, highlights and contrast                                  |                                                                                                                                                                                                                  |
| Object removal              | An image patch layer masked to the painted area                                                                          | Paint over the object with the selection brush (Q), then click **Remove**. You see a preview with **Apply** or **Cancel**. The region is rendered at full resolution, inpainted at up to 1024 px, then upscaled. |
| AI denoise                  | A full-resolution denoised layer above the photo; intensity is the layer's opacity                                       | Computed from the developed photo, so re-run it after large tone edits. Limited to about 40 MP.                                                                                                                  |
| AI upscale 2× / 4×          | A **new project**; the current one is unchanged                                                                          | The UI states: _"AI upscaling generates estimated detail; it cannot recover information that was never captured."_ The result is capped at 64 MP / 16384 px.                                                     |
| Portrait enhancement        | A retouch layer with texture-preserving skin smoothing, plus a tone adjustment layer, both masked to skin on the subject | Never warps or reshapes faces. Skin detection uses a YCbCr rule within the subject mask.                                                                                                                         |
| AI Auto Edit                | An optional switch in the Auto Edit dialog                                                                               | Retargets exposure on the detected subject. You still review the values and choose Apply or Cancel. The rule-based Auto Edit is unchanged.                                                                       |

## Implementation

- **Code layout:**
  - `workers/ai.worker.ts` contains the task handlers, run by `workers/pipeline.worker.ts`. That single worker entry also serves export and HEIC jobs.
  - `engine/ai/aiClient.ts` is the main-thread API: installation checks (HEAD requests), progress and cancellation.
  - `engine/ai/imageOps.ts` holds the pure helpers: CHW tensors, mask resize, guided filter, tile plan and skin mask. They are unit-tested.
  - `components/editor/ai/aiActions.ts` turns model outputs into masks, layers and projects.
- **Tiling:** tiled models (denoise and upscale) process overlapping tiles and keep only each tile's core. Memory is bounded by the output image.
- **SCUNet:** tiles are edge-padded to multiples of 64, which the windowed attention requires.
- **Masks:** segmentation masks are computed from the displayed preview, at up to the preview resolution (≤ 4096 px in Quality mode). Object removal and denoise work from full-resolution renders.

## Limitations

- WebGPU availability varies by browser. Without it, large denoise and upscale jobs are slow, so a progress bar and Cancel are shown.
- Segmentation masks are not full sensor resolution on very large images.
- No cloud processing exists. If it is ever added, it must ask for consent ("This feature requires uploading your image for processing."), and **Settings → Local processing only** blocks it.
- The RAW denoiser found during research (RapidRAW Nonlocal, MIT) works on Bayer RAW data, not RGB. It is not used yet.
