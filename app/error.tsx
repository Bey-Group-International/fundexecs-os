'use client';

import { useEffect } from 'react';

/**
 * Route-segment error boundary. Renders inside the root layout (so the app
 * chrome stays), reports to Sentry when configured, and offers a retry.
 * Tokens-only styling on a solid `bg-bg-1` surface.
 */
export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // DSN-gated lazy import — no-op when Sentry isn't configured.
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
    void import('@sentry/nextjs').then((Sentry) => Sentry.captureException(error));
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg-1 px-6 text-center">
      <h1 className="text-2xl font-semibold text-fg-1">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-fg-4">
        An unexpected error occurred. You can try again, and if it keeps happening reach out to
        support.
      </p>
      {error.digest ? (
        <p className="mt-1 text-xs text-fg-5">
          Reference: <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-xl border border-hairline bg-surface-1 px-5 py-2 text-sm font-medium text-fg-1 transition hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
        >
          Try again
        </button>
        {/* Full-document navigation (not a soft route) — an escape hatch when a
            persistent error makes `reset()` loop on the same broken state. A
            hard reload is the point here, so the next/link rule doesn't apply. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="rounded-xl px-5 py-2 text-sm font-medium text-fg-3 transition hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
        >
          Back to home
        </a>
      </div>
    </main>
  );
}
