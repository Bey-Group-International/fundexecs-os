"use client";

import { useEffect } from "react";

// The build this bundle came from, inlined by next.config.mjs. It becomes the
// service worker's cache key.
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev";

// Registers the app-shell service worker (public/sw.js) for installed / PWA
// usage: an offline fallback and fast repeat-navigations. Registration is
// production-only so the dev server's HMR is never intercepted. The worker is
// deliberately conservative — it never touches API routes, auth, or non-GET
// requests, so it cannot affect the web/desktop experience.
//
// The build id rides along on the script URL. Registration is keyed by scope,
// so pointing the same scope at `/sw.js?v=<newer build>` updates the existing
// registration rather than creating a second one — and because the URL differs,
// the browser treats it as a new worker and re-runs `install`. That is what
// keeps the precached /offline page current and lets the worker sweep the
// previous build's caches. Navigations are network-first, so a cold launch of
// the installed app fetches fresh HTML, which carries the new build id, which
// hands the worker its own update signal.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker
        .register(`/sw.js?v=${encodeURIComponent(BUILD_ID)}`, { scope: "/" })
        .catch(() => {
          /* registration is best-effort — the app works fine without it */
        });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
