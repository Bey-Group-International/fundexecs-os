/**
 * Sentry — server (Node.js runtime) init.
 *
 * DSN-gated: when `NEXT_PUBLIC_SENTRY_DSN` is absent, `Sentry.init` is never
 * called, so Sentry is a complete no-op. This is what keeps `npm run build` and
 * runtime green with zero Sentry env configured.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    // Conservative default; tune via SENTRY_TRACES_SAMPLE_RATE without a redeploy.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    // Quiet in dev; Sentry's own logs are noise unless actively debugging.
    debug: false
  });
}
