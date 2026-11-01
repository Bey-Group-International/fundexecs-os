import { createRequire } from "node:module";

// lib/security-headers.cjs is CommonJS so tests can require it too.
const { securityHeaderRules } = createRequire(import.meta.url)("./lib/security-headers.cjs");

// A short, stable identifier for this build. It is appended to the service
// worker's registration URL, which makes it the app-shell cache's version key:
// a new build is a new worker script URL, so the browser installs it, refreshes
// the precache, and drops the previous build's caches. Prefer an explicit
// override, then the deploying commit; "dev" keeps local builds on one key so
// repeated `next build` runs don't churn the cache. Non-alphanumerics are
// stripped because the value is interpolated into a query string.
const BUILD_ID = (
  process.env.NEXT_PUBLIC_BUILD_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  "dev"
)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "")
  .slice(0, 12) || "dev";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Inlined at build time so client bundles (and the service worker
  // registration in particular) can read it without a runtime round trip.
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
  async headers() {
    return [
      // Site-wide headers, then the stricter set for the public investor pages
      // under /lp/ (their URL is a bearer link). Defined in lib/security-headers.cjs.
      ...securityHeaderRules({ dev: process.env.NODE_ENV !== "production" }),
      {
        // The camera-background segmenter: a ~12MB wasm runtime, its loader and a
        // 250KB model, all under the same names from one build to the next, which
        // rules out `immutable`. A day keeps a returning member from re-checking
        // twelve megabytes every time they open the picker; the cost is that a
        // MediaPipe upgrade reaches a browser that already has the old pair a day
        // late, and the old pair still works together. Declared after the rule
        // above so it is the later of two matches for the same key.
        source: "/mediapipe/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },
  async redirects() {
    return [
      {
        // The Materials & Data Room module key is `data_room`; any older links
        // or bookmarks pointing to /build/materials now land correctly.
        source: "/build/materials",
        destination: "/build/data_room",
        permanent: true,
      },
      {
        // /source/lp was a legacy URL surfaced during QA — now redirects to
        // the correct module key.
        source: "/source/lp",
        destination: "/source/lp_pipeline",
        permanent: true,
      },
      // Hyphen variants of underscore-slug Source Hub routes.
      { source: "/source/lp-pipeline", destination: "/source/lp_pipeline", permanent: true },
      { source: "/source/deal-pipeline", destination: "/source/deal_pipeline", permanent: true },
      // Alternate slug names surfaced during QA.
      { source: "/source/debt_hybrid", destination: "/source/debt", permanent: true },
      { source: "/source/debt-hybrid", destination: "/source/debt", permanent: true },
      // Legacy routing-review URL — correct path is /grid/review.
      { source: "/routing-review", destination: "/grid/review", permanent: true },
      // /deal_pipeline without hub prefix — sourcing automation used to generate
      // this URL; correct path is /source/deal_pipeline.
      { source: "/deal_pipeline", destination: "/source/deal_pipeline", permanent: true },
      // LP Report — Execute › Reporting is the single reporting surface; send
      // legacy LP-report URLs straight there in one hop (/reports itself just
      // re-redirects to /execute/reporting).
      { source: "/lp-report", destination: "/execute/reporting", permanent: true },
      { source: "/lp_report", destination: "/execute/reporting", permanent: true },
      // Graphs — nav link points to /graph (singular); redirect plural variant.
      { source: "/graphs", destination: "/graph", permanent: true },
      // Legacy match-inbox URL — canonical destination is /inbox.
      { source: "/match-inbox", destination: "/inbox", permanent: true },
      // Network is now a standalone side-rail destination, no longer a Source
      // module. Heal old /source/network links (and its session-frame variant).
      { source: "/source/network", destination: "/network", permanent: true },
      // Outreach moved from Source to Run, and its cadence tools then moved into
      // Run › Campaigns when Run › Onboarding took the Outreach slot.
      { source: "/source/outreach", destination: "/run/campaigns", permanent: true },
      { source: "/run/outreach", destination: "/run/campaigns", permanent: true },
      // Documents moved from Run to Build.
      { source: "/run/documents", destination: "/build/documents", permanent: true },
      // Run's "Brains" module was renamed to "Evaluate".
      { source: "/run/brains", destination: "/run/evaluate", permanent: true },
      // Campaigns moved from a standalone page into Run › Campaigns.
      { source: "/campaigns", destination: "/run/campaigns", permanent: true },
      // The Signing module used to link envelope actions under
      // /execute/signing/* — routes that never existed (the wizard/detail live
      // at /envelopes/*). Heal any stale bookmarks. The bare /execute/signing
      // module page is unaffected (no trailing segment).
      { source: "/execute/signing/new", destination: "/envelopes/new", permanent: true },
      { source: "/execute/signing/:id", destination: "/envelopes/:id", permanent: true },
    ];
  },
};

export default nextConfig;
