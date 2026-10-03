# PWA

- **Manifest:** `app/manifest.ts`, served at `/manifest.webmanifest`. It includes name, short_name, description, start_url, standalone display, theme and background colours, any and maskable icons, wide and narrow screenshots, and shortcuts (Camera, Editor, Projects).
- **Icons:** `public/icons/icon.svg` is rendered to PNG by `npm run icons`.

## Service worker

The source is `scripts/sw.template.js`. `npm run build` stamps a unique version and writes `public/sw.js`, which is gitignored. Registration is in `components/app/ServiceWorkerManager.tsx` and happens in production only, unless `NEXT_PUBLIC_ENABLE_SW_IN_DEV=1` is set.

Caching:

| What                                                              | Cache                        | Strategy                                                                                   |
| ----------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| Shell routes `/`, `/camera*`, `/editor`, `/projects`, `/settings` | `prostudio-shell-<version>`  | Pre-cached at install, together with the `/_next/static/*` assets their HTML references    |
| Navigations                                                       | `prostudio-shell-<version>`  | Network first, falling back to the cache. Updates are picked up whenever the app is online |
| `/_next/static/*`, `/icons/*`                                     | `prostudio-static-<version>` | Cache first. These files are content-hashed                                                |
| `/models/*`, `/wasm/*`                                            | `prostudio-models-v1`        | Cache first. Kept across releases                                                          |

Activation deletes old `prostudio-*` caches. User images never touch the network, so they never enter any cache. Projects live in IndexedDB.

## Updates

A new worker waits until the user clicks **Update** in the toast. The page then sends `SKIP_WAITING` and reloads once on `controllerchange`. It never reloads silently in the middle of an edit.

## Offline

Offline you can use the home page, projects, the editor, export, settings, and the camera (if the browser allows it). An indicator appears when offline.

## Install

The `beforeinstallprompt` event drives an "Install app" button. On iOS, Share → Add to Home Screen instructions are shown instead.

## Testing

`tests/e2e/pwa.spec.ts` checks the manifest and its icons, the security headers, service-worker control, and offline reloads of `/` and `/editor`.

## Runtimes and models

- `/wasm/` (ONNX Runtime, LibRaw, libheif) and `/models/` (AI models) are cached **on first use**, cache-first, in `prostudio-models-v1`. That cache survives app updates, so a model downloaded once keeps working offline.
- They are not pre-cached at install, so installing the PWA stays small.
- The headers include COOP `same-origin` and COEP `require-corp` (cross-origin isolation for multi-threaded WebAssembly). Every resource is same-origin, so nothing breaks.
