/**
 * Sentry — browser/client init.
 *
 * Next.js loads this on the client. DSN-gated: with no
 * `NEXT_PUBLIC_SENTRY_DSN` the SDK never initializes, so no telemetry leaves the
 * browser and the bundle stays inert. The router-transition hook is exported
 * unconditionally (it's a no-op when Sentry isn't initialized).
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    // Session Replay is opt-in via env so it never inflates the bundle by default.
    replaysSessionSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY_SAMPLE_RATE ?? 0),
    replaysOnErrorSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE ?? 0
    ),
    debug: false
  });
}

// Captures client-side navigation spans. No-op when Sentry isn't initialized.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
