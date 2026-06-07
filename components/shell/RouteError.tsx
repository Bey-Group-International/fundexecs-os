'use client';

import { useEffect } from 'react';

export interface RouteErrorProps {
  /** Surface label shown in the copy (e.g. "Pipeline"). */
  label?: string;
  /** The error thrown by the route segment. */
  error: Error & { digest?: string };
  /** Re-render the segment from scratch (Next.js error-boundary reset). */
  reset: () => void;
}

/**
 * RouteError — a tasteful, tokens-only error boundary body for a route
 * segment's `error.tsx`. Must be rendered from a Client Component (the route
 * `error.tsx` carries the `'use client'` directive). Solid `bg-bg-1` canvas,
 * a single card, and a "Try again" CTA wired to Next.js's `reset()`.
 *
 * Distinct from the app-level boundaries in `app/error.tsx` /
 * `app/global-error.tsx` (owned by the observability work): this is the
 * per-segment fallback so one heavy route failing never blanks the whole app.
 */
export function RouteError({ label, error, reset }: RouteErrorProps) {
  useEffect(() => {
    // Surface for local debugging; the app-level boundary owns Sentry capture.
    console.error(`[${label ?? 'route'}] segment error`, error);
  }, [error, label]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-1 px-6 py-16">
      <div className="w-full max-w-md rounded-2xl border border-hairline bg-surface-1 p-8 text-center shadow-[var(--shadow-md)]">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-danger">
          Something went wrong
        </p>
        <h1 className="mt-2 text-[16px] font-semibold text-fg-1">
          {label ? `We couldn’t load ${label}` : 'We couldn’t load this page'}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-[12.5px] text-fg-4">
          A temporary error interrupted this surface. Your data is safe — try again, and if it keeps
          happening, refresh or come back in a moment.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[10px] text-fg-5">ref: {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex items-center gap-1.5 rounded-xl border border-transparent bg-[var(--cta-gradient)] px-4 py-2 text-[12.5px] font-semibold text-white shadow-[var(--shadow-cta)] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
