/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
      // LP Report — nav link points to /reports; redirect stale manual URLs.
      { source: "/lp-report", destination: "/reports", permanent: true },
      { source: "/lp_report", destination: "/reports", permanent: true },
      // Graphs — nav link points to /graph (singular); redirect plural variant.
      { source: "/graphs", destination: "/graph", permanent: true },
      // Legacy match-inbox URL — canonical destination is /inbox.
      { source: "/match-inbox", destination: "/inbox", permanent: true },
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
