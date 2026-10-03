# Camera

## Permission flow

The homepage and the mode chooser (`/camera`) never call `getUserMedia`; e2e tests assert this. The camera is requested only when you press "Grant camera access" or open `/camera/auto` or `/camera/manual`.

`camera/deviceManager.ts` maps errors to messages:

| Error                  | Meaning shown to the user                                                  |
| ---------------------- | -------------------------------------------------------------------------- |
| `NotAllowedError`      | Camera access was denied. Explains how to re-enable it in browser settings |
| `NotFoundError`        | No camera found                                                            |
| `NotReadableError`     | The camera is in use by another app                                        |
| `OverconstrainedError` | The requested resolution isn't supported, so a lower one is tried          |
| Insecure context       | The camera needs HTTPS                                                     |

## Capabilities

`camera/capabilities.ts` normalises `MediaStreamTrack.getCapabilities()` and `ImageCapture.getPhotoCapabilities()` into a typed `CameraCapabilities`. Each control in the UI comes from this object. Anything missing is shown as "Not available on this device/browser".

### Hardware controls

A hardware value counts as applied only after `applyConstraints` succeeds **and** `getSettings()` confirms it.

| Control               | Constraint                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| ISO and shutter       | `exposureMode: "manual"` with `iso` and `exposureTime`. `exposureTime` is in units of 100 µs, so 1/250 s = 40 |
| Exposure compensation | `exposureCompensation`                                                                                        |
| White balance         | `whiteBalanceMode: "manual"` with `colorTemperature`. Kelvin presets are limited to the device's range        |
| Focus                 | `focusMode` (continuous, single-shot, manual) and `focusDistance`, in the device's own units                  |
| Tap-to-focus          | `pointsOfInterest`                                                                                            |
| Zoom                  | `zoom`, labelled "Zoom (device)" because the API doesn't say whether it is optical                            |
| Torch                 | `torch`                                                                                                       |
| Flash                 | `fillLightMode`, listing only the modes the device reports, plus red-eye where available                      |
| Full-sensor capture   | `ImageCapture.takePhoto()` at the largest `imageWidth`/`imageHeight`                                          |

### Software alternatives

These are always labelled as software.

- Aperture always reads "not controllable from the browser". There is no API for it.
- Digital zoom, aspect ratio and selfie mirroring are stored as recipe crop and flip. Captured pixels are never altered.
- When the device has no exposure compensation, the EV control becomes "Digital exposure adjustment (software correction)", applied through the recipe.
- When there is no Kelvin control, white-balance presets become a recipe temperature, via `kelvinToTemperatureSlider`.

## AutoCameraEngine (`camera/autoCamera.ts`)

The engine analyses a 160 px frame at about 8–10 fps:

- histograms, mean luminance and clipping;
- motion (frame difference);
- backlight (centre versus edges);
- dominant hue and grey-world colour temperature;
- faces, through the `FaceDetector` API where the browser has it.

The scene classifier (`camera/sceneDetection.ts`) is **heuristic** and is labelled "(estimated)". Portrait is reported only when faces are actually detected.

Main methods:

- `analyzeScene()`
- `calculateExposure` / `calculateWhiteBalance` / `calculateFocus`
- `recommendSettings()`
- `applySupportedSettings()`, which returns `{applied (confirmed), rejected, settings}`
- `capture({kind})`
- `optimizeCapturedImage()`, which returns non-destructive recipe corrections rather than changing pixels

## Multi-frame capture (`camera/multiFrame.ts`)

**Night mode** captures 8 full-resolution frames. They are aligned by translational search on downsampled luma, averaged in float, and saved as PNG.

**HDR** is offered only when exposure compensation or `exposureTime` is controllable. It takes a real −2/0/+2 bracket, checks that each exposure was applied, and merges the frames with exposure fusion. If the bracket can't be applied, it cancels and says so.

## Known limitations

- Switching between Auto and Manual reopens the stream.
- Night and HDR merges run on the main thread, taking about 1 s at 1080p.
- Software white balance and EV appear in the editor, not in the live preview. The UI says so.

## Cross-browser notes

- Chromium is tested with a fake camera device.
- WebKit's automated browser has no fake camera. Its tests check graceful degradation instead: the mode chooser works and a clear message is shown.
- Real hardware controls (ISO, shutter, white balance) still need a physical Android device to verify.
