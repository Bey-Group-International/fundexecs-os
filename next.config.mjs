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
    ];
  },
};

export default nextConfig;
