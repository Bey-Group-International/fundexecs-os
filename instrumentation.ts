/**
 * Next.js instrumentation hook — runs once per server/edge runtime on boot.
 *
 * Loads the runtime-appropriate Sentry config (each is itself DSN-gated, so this
 * is a no-op without `NEXT_PUBLIC_SENTRY_DSN`). `onRequestError` forwards
 * uncaught server/render errors to Sentry when configured.
 */
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
