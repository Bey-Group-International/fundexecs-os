/**
 * Sentry — edge runtime init (middleware, edge routes).
 *
 * DSN-gated like the server config: no DSN → no init → no-op. Keeps the build
 * and edge runtime green with zero Sentry env.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    debug: false
  });
}
