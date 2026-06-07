import { withSentryConfig } from '@sentry/nextjs';

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

// Only attempt source-map upload when an auth token is present. This is the
// critical build-safe gotcha: with no SENTRY_AUTH_TOKEN (and no org/project)
// the Sentry webpack plugin skips upload entirely instead of failing the build.
const hasSentryAuth =
  !!process.env.SENTRY_AUTH_TOKEN && !!process.env.SENTRY_ORG && !!process.env.SENTRY_PROJECT;

/** @type {import('@sentry/nextjs').SentryBuildOptions} */
const sentryBuildOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Suppress all Sentry CLI logs during build (no noisy "no auth token" output).
  silent: true,
  // Without auth creds, disable source-map upload so the build never tries to
  // talk to Sentry (which would require a token). When creds ARE present,
  // upload + delete the local maps so they aren't served publicly.
  sourcemaps: {
    disable: !hasSentryAuth,
    deleteSourcemapsAfterUpload: hasSentryAuth
  },
  // Route browser telemetry through the app to dodge ad-blockers (no token needed).
  tunnelRoute: '/monitoring',
  // Tree-shake Sentry debug logging out of the client bundle (new, non-deprecated
  // form of the old `disableLogger`). No-op under Turbopack but correct for webpack.
  webpack: { treeshake: { removeDebugLogging: true } },
  // Don't widen the upload scope; nothing to upload without auth anyway.
  widenClientFileUpload: false
};

// `withSentryConfig` is safe to apply unconditionally: with no DSN the runtime
// init is skipped, and with no auth token source-map upload is disabled above,
// so `npm run build` succeeds with zero Sentry env vars set.
export default withSentryConfig(nextConfig, sentryBuildOptions);
