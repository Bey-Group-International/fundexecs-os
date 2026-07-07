"use client";

import { useEffect } from "react";

// Registers the app-shell service worker (public/sw.js) for installed / PWA
// usage: an offline fallback and fast repeat-navigations. Registration is
// production-only so the dev server's HMR is never intercepted. The worker is
// deliberately conservative — it never touches API routes, auth, or non-GET
// requests, so it cannot affect the web/desktop experience.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* registration is best-effort — the app works fine without it */
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
