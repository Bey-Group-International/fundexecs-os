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
        permanent: false,
      },
      // Hyphen variants of underscore-slug Source Hub routes.
      { source: "/source/lp-pipeline", destination: "/source/lp_pipeline", permanent: false },
      { source: "/source/deal-pipeline", destination: "/source/deal_pipeline", permanent: false },
      // Alternate slug names surfaced during QA.
      { source: "/source/debt_hybrid", destination: "/source/debt", permanent: false },
      { source: "/source/debt-hybrid", destination: "/source/debt", permanent: false },
      // Legacy routing-review URL — correct path is /grid/review.
      { source: "/routing-review", destination: "/grid/review", permanent: false },
    ];
  },
};

export default nextConfig;
