/* ProStudio service worker.
 * Generated from scripts/sw.template.js by scripts/build-sw.mjs — edit the template, not public/sw.js.
 *
 * Caching policy:
 *  - App shell routes: precached on install (HTML + the hashed JS/CSS they reference).
 *  - /_next/static/*: cache-first (content-hashed, immutable).
 *  - Navigations: network-first with cache fallback (so updates are picked up online).
 *  - /models/*: cache-first in a separate long-lived cache (AI models, only when requested).
 *  - User images are never fetched over the network, so they never enter these caches.
 */
const VERSION = "__BUILD_VERSION__";
const SHELL_CACHE = `prostudio-shell-${VERSION}`;
const STATIC_CACHE = `prostudio-static-${VERSION}`;
const MODEL_CACHE = "prostudio-models-v1";
const SHELL_ROUTES = ["/", "/camera", "/camera/auto", "/camera/manual", "/editor", "/projects", "/settings"];

async function precacheShell() {
  const shell = await caches.open(SHELL_CACHE);
  const statics = await caches.open(STATIC_CACHE);
  const assetUrls = new Set(["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"]);
  for (const route of SHELL_ROUTES) {
    try {
      const res = await fetch(route, { cache: "no-cache" });
      if (!res.ok) continue;
      const html = await res.clone().text();
      await shell.put(route, res);
      for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) assetUrls.add(m[1]);
    } catch {
      /* offline during install — the route will be cached on first online visit */
    }
  }
  await Promise.all(
    [...assetUrls].map(async (url) => {
      try {
        const res = await fetch(url);
        if (res.ok) await statics.put(url, res);
      } catch {
        /* ignore */
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, STATIC_CACHE, MODEL_CACHE]);
      for (const key of await caches.keys()) {
        if (key.startsWith("prostudio-") && !keep.has(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") cache.put(request, res.clone());
  return res;
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  const url = new URL(request.url);
  const key = url.pathname.replace(/\/$/, "") || "/";
  try {
    const res = await fetch(request);
    if (res.ok && res.type === "basic") cache.put(key, res.clone());
    return res;
  } catch {
    const hit = (await cache.match(key)) || (await cache.match("/"));
    if (hit) return hit;
    return new Response("<h1>Offline</h1><p>ProStudio has not been cached yet. Connect once to install it.</p>", {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }
  if (url.pathname.startsWith("/models/") || url.pathname.startsWith("/wasm/")) {
    event.respondWith(cacheFirst(request, MODEL_CACHE));
    return;
  }
  if (url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(request)) || Response.error()),
    );
  }
});
