/*
 * FundExecs OS — app-shell service worker.
 *
 * Deliberately conservative. It exists to give the installed / PWA experience
 * (1) an offline fallback for navigations and (2) fast repeat loads of static
 * assets. It NEVER intercepts:
 *   - non-GET requests
 *   - API routes (/api/*) or auth callbacks
 *   - cross-origin requests
 * so it cannot affect data freshness, mutations, or the web/desktop experience.
 */

/*
 * The cache key is stamped with the build id that ServiceWorkerRegister passes
 * on the registration URL (`/sw.js?v=<build>`), NOT hardcoded. A hardcoded key
 * is a worker that never changes: `install` would run exactly once per device,
 * pinning the precached /offline page to whatever shipped the day the user
 * first loaded the app, and `activate` would never prune, so every deploy's
 * _next/static chunks would pile up in the installed app's storage forever.
 * Keying on the build makes each deploy a fresh worker that re-precaches and
 * sweeps its predecessors.
 */
const BUILD = new URL(self.location.href).searchParams.get("v") || "dev";
const VERSION = `fx-os-${BUILD}`;
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => undefined),
  );
  /*
   * No skipWaiting: a new build waits for the old one to be released rather
   * than seizing control mid-session. Activating early would run the prune
   * below while a loaded page still depends on the previous build's chunks —
   * which a redeploy has already removed from the origin — turning a routine
   * deploy into a chunk-load error for anyone with the app open. The installed
   * app picks the new worker up on its next cold launch instead.
   */
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  // Navigations: network-first with an offline fallback. Never serve a stale
  // page from cache when the network is available.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(OFFLINE_URL).then((r) => r || new Response("", { status: 503 })),
      ),
    );
    return;
  }

  // Static assets (Next build output, icons, images): stale-while-revalidate.
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/assets/") ||
    /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(url.pathname);

  if (isStatic) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => {
              if (res && res.status === 200) return cache.put(req, res.clone()).then(() => res);
              return res;
            })
            .catch(() => cached);
          // When we answer from cache the revalidation is the only work left,
          // and an idle worker can be terminated before its cache write lands —
          // which would re-serve the same stale asset on every subsequent load.
          // waitUntil keeps the worker alive until the write completes.
          if (cached) event.waitUntil(network);
          return cached || network;
        }),
      ),
    );
  }
});
