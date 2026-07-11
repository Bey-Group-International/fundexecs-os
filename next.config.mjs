/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // Command Center → Virtual Office. The spatial workspace was renamed;
      // /virtual-office is canonical. Preserve nested segments and query
      // strings (Next.js carries the query automatically) so existing
      // bookmarks, deep links, and invite URLs (?room=&meet=&deal=&invite=)
      // keep working in one hop. The bare path and the wildcard are separate
      // rules so /command-center itself also redirects.
      { source: "/command-center", destination: "/virtual-office", permanent: true },
      { source: "/command-center/:path*", destination: "/virtual-office/:path*", permanent: true },
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
      // Outreach moved from Source to Run.
      { source: "/source/outreach", destination: "/run/outreach", permanent: true },
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
