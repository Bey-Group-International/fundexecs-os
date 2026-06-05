/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Server Actions origin allowlist for proxy / preview hosts whose
    // `Origin` header differs from `x-forwarded-host`. Next.js 14+ aborts
    // the action on that mismatch unless the origin domain is allowed
    // here. NOTE: Next.js wildcards only match ONE label per `*`. Multi-
    // label hosts (e.g. `phase4-survey.cluster-8.preview.emergentcf.cloud`,
    // 5 labels deep) require the recursive `**` form.
    serverActions: {
      allowedOrigins: [
        'phase4-survey.preview.emergentagent.com',
        '**.preview.emergentcf.cloud',
        '**.preview.emergentagent.com',
        'www.fundexecs.com',
        'auth.fundexecs.com'
      ]
    }
  }
};

export default nextConfig;
