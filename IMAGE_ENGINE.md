# Image engine

## Recipe → pixels

`buildDevelopParams(recipe)` flattens the recipe into numeric parameters. The per-pixel maths is written twice and must be kept in sync:

- `engine/color/pipeline.ts` → `developPixel()`: the CPU reference. It is used by the CPU fallback renderer and serves as the oracle for unit tests.
- `engine/gl/shaders.ts` → `DEVELOP_FS`: a line-by-line port to GLSL ES 3.00.

### Stage order

Input is sRGB-encoded.

1. **Noise reduction.** Luminance is smoothed toward the small/medium blurred luma, with edge weighting. Chroma is smoothed toward the medium blurred Cb/Cr.
2. **White balance**, in linear light. Gains are ratios of black-body colours (Kim et al. Planckian locus → XYZ → linear sRGB) between 6500 K and the slider-derived scene temperature, normalised to keep luminance. Tint scales the green channel.
3. **Exposure.** Multiply by 2^EV, in linear light.
4. **Dehaze.** Dark-channel prior using a large-radius blurred minimum channel and white airlight.
5. **Shadows / highlights.** A local exposure gain driven by a blend of pixel luma and large-radius blurred luma, which limits halos.
6. **Whites / blacks.** Endpoint shaping.
7. **Contrast.** A power S-curve pivoting on 0.5.
8. **Brightness and gamma.** Midtone power.
9. **Clarity / texture / sharpening.** Detail layers (source luma minus large, medium or small blur). Clarity is weighted toward midtones.
10. **Hue rotation, HSL mixer** (8 bands as a smooth partition of unity), **saturation, and vibrance** (vibrance protects skin tones).
11. **Three-way colour grading** (shadows, midtones, highlights and global, with blending and balance), then **colour balance**.
12. **Curves.** The master curve, then per-channel curves. They use monotone cubic (Fritsch–Carlson) interpolation baked into a 1024-entry RGBA16F texture.
13. **3D LUT** (`.cube`, trilinear, `TEXTURE_3D`), mixed by intensity.
14. **Post-crop vignette.** Superellipse with midpoint, feather and roundness, in output space.
15. **Grain.** Hashed at full-resolution pixel coordinates.

## Local features

The source is converted once into a feature map `(luma, linear min-channel, Cb+0.5, Cr+0.5)`. It is then blurred at three radii:

- **large:** 2% of the short side;
- **medium:** 0.4% of the short side;
- **small:** the sharpen radius.

Radii are defined in full-resolution pixels and scaled to the current source, so the preview and the export match. Large blurs downsample in steps of 2× until the kernel is at most about 6σ wide. Feature maps are cached until the source or the radii change, so a slider drag only re-runs the develop pass.

The targets are RGBA16F when `EXT_color_buffer_float` is available, otherwise RGBA8. The chroma offset lets the 8-bit targets store negative values.

## Geometry

`engine/image/transform.ts` combines quarter rotation, flips, straighten, perspective (a 4-point homography), skew, scale and crop into **one 3×3 projective matrix** from output pixel to source pixel. The shader inverse-maps each output pixel and samples the source once, using mipmapped trilinear sampling. There is no chain of resamples, so geometry adds no cumulative softness.

`maxInscribedCrop` computes the largest crop with the image's aspect ratio that stays inside the frame after straightening.

## Preview vs export

|        | Preview                                                                                      | Export                                                                                                                                                                                                      |
| ------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source | Bitmap downscaled to 1600, 2560 or 4096 px long edge (Performance, Balanced or Quality mode) | The original, decoded again at full resolution                                                                                                                                                              |
| Where  | Main thread, WebGL2 canvas (or CPU)                                                          | Worker with OffscreenCanvas and WebGL2, or the main thread as a fallback                                                                                                                                    |
| How    | One draw per animation frame                                                                 | Output split into tiles of at most 2048 px. Each tile maps back to the source region it needs, plus a margin of 3σ of the largest blur, and is uploaded, rendered, read back and placed with `putImageData` |

Resize happens only when the user asks for it. It halves the image repeatedly, then does a final high-quality step.

Encoding uses `OffscreenCanvas.convertToBlob` for JPEG, PNG, WebP and AVIF, and UTIF for uncompressed TIFF.

Metadata:

- **JPEG:** the original's APP1 EXIF segment is transplanted. Orientation is set to 1, IFD1 (the embedded thumbnail) is removed, and GPS is optionally emptied.
- **PNG:** the same EXIF is written as an `eXIf` chunk.

## CPU fallback

`engine/cpu/CpuRenderer.ts` uses the same `developPixel()`. Its blurs are three-box approximations of a Gaussian, with an exact kernel below σ = 2, and it samples bilinearly. It is used when WebGL2 is unavailable or when GPU acceleration is turned off in Settings.

## Auto Edit

`engine/analysis/autoEdit.ts` measures:

- luma percentiles, clipping and spread;
- a grey-world estimate over near-neutral pixels, solved for the temperature/tint sliders and applied at 60%;
- mean saturation;
- a skin-tone fraction (a YCbCr rule);
- Immerkær's noise σ on a 1:1 crop.

From these it proposes bounded adjustments. Every value is shown to the user before anything is applied.

## Layers and compositing

The layer model is in `types/layers.ts`. Layers are **immutable values**: every edit creates new objects, so history snapshots share unchanged layers and operations instead of copying them.

**Coordinates.** All layer geometry, masks and strokes are in **frame pixels**: full-resolution pixels of the warped frame, after rotation, straighten and perspective but before crop. Cropping therefore never moves layers. Everything is rasterised for a `View` (origin, scale and size), so the preview and full-resolution export tiles use the same code.

**Stack.** Index 0 is the base layer (the developed photo, which may have a mask). Above it can be:

| Kind         | Content                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `image`      | A reference to an asset; never a copy                                                                            |
| `text`       | Text                                                                                                             |
| `shape`      | A shape                                                                                                          |
| `adjustment` | Exposure, contrast, highlights, shadows, saturation, temperature, tint and hue, applied to everything beneath it |
| `group`      | Isolated composite of its children, blended as one                                                               |
| `paint`      | Brush strokes, stored as operations                                                                              |
| `retouch`    | Retouch operations re-applied to the image beneath                                                               |

**GPU compositor** (`engine/gl/Compositor.ts`), running in the develop pass's WebGL2 context:

```
develop(base) → [base mask/opacity] → accum
for each layer: content (Canvas2D raster, uploaded) → mask → blend(accum, content, mode, opacity)
```

- **Blend modes:** all 11 follow the W3C Compositing spec, on premultiplied colour. They are shared as GLSL (`BLEND_GLSL`) and a CPU reference (`blendColor`/`compositePixel`) that is unit-tested.
- **Adjustment layers:** `ADJUST_GLSL` mirrors `adjustPixel()`.
- **CPU fallback** (`engine/layers/cpuCompositor.ts`): uses Canvas2D's native implementations of the same blend modes. Retouch layers need WebGL2 and are reported as unsupported, never silently dropped.

## Masks and selections

A mask, and also a selection, is a `MaskDoc`: a base value (0 or 1) plus an ordered list of operations:

- `rect`, `ellipse`, `polygon`, `stroke`, `gradient`, `raster`, or a nested `mask`, each with `add`, `subtract`, `intersect` or `replace`;
- `feather`, `expand` (negative contracts) and `invert`.

Rasterisation (`engine/layers/raster.ts`) composites each operation with Canvas2D. Feather and expand are CPU Gaussian or threshold passes, rendered with a margin so tile edges are exact. `OpListCache` keeps operations 0..n−2 in a stable canvas and redraws only the newest one, so a live stroke costs one copy plus one stroke per frame.

Pixel-derived selections (magic wand, colour range, AI segmentation, background eraser) become a single `raster` op that references a small PNG asset, computed at the displayed preview resolution.

## Brush engine

`engine/layers/dabs.ts` turns stroke points into evenly spaced dabs:

- spacing is carried across segments;
- pressure scales size, where the device reports it;
- an EMA smoother removes jitter.

Input uses pointer events, including coalesced events. Mouse, touch and pen are supported; a second touch cancels the stroke and pinch-zooms. Paint and mask strokes are rasterised from a cached brush stamp per hardness value.

## Retouching

Retouching (`engine/gl/RetouchRenderer.ts`) happens on the GPU and is non-destructive. Each stroke's coverage is drawn as GPU dab quads with alpha accumulation, then applied as `mix(W, effect(W), coverage × opacity)`:

| Tool             | Effect                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clone            | Samples the image at the source offset                                                                                                             |
| Heal             | Uses texture from the source and tone from the destination. The tone is interpolated by normalised convolution, from outside the healed area only. |
| Spot heal        | Same as heal; the source is chosen automatically (`engine/layers/healSource.ts`)                                                                   |
| Dodge / burn     | Exposure change weighted by tonal range                                                                                                            |
| Blur / sharpen   | Low-pass copy, or an unsharp mask                                                                                                                  |
| Dust & scratches | Replaces outliers that differ from the low-pass copy by more than the threshold                                                                    |
| Red-eye          | Detects and desaturates red pixels                                                                                                                 |
| Smudge           | Sequential: each dab pulls colour from the previous position, using scissored ping-pong buffers                                                    |
| Skin             | Removes the mid-frequency band only (used by portrait enhancement)                                                                                 |

Because clone sources can lie anywhere, documents with retouch layers export in **one pass**, limited by the GPU's maximum texture size. Every other document exports in tiles.

## Export invariants

These hold regardless of layers:

- The original file is decoded again at full resolution for export.
- Output size equals the crop of the full-resolution frame, unless you resize.
- A stack containing only the base photo uses exactly the original develop-only tile path.
- JPEG and PNG exports are tagged with a generated sRGB ICC v2 profile (`engine/color/icc.ts`), because the pixels are sRGB.
- Metadata modes are keep all, remove location, or remove all. JPEG originals have their EXIF copied; other originals get fresh EXIF written from their parsed metadata (`engine/export/exifWriter.ts`).
