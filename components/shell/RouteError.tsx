'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** Human-readable route name, e.g. "Capital Stack". */
  routeName?: string;
}

/**
 * RouteError — per-route error boundary UI.
 *
 * Renders inside the AuthedShell so the nav chrome stays visible. Reports
 * to Sentry when configured (DSN-gated). Tokens-only styling on a solid
 * `bg-bg-1` surface per the release-sweep guardrails.
 */
export function RouteError({ error, reset, routeName }: RouteErrorProps) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
    void import('@sentry/nextjs').then((Sentry) => Sentry.captureException(error));
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center bg-bg-1 px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--danger-line)] bg-[var(--danger-soft)] text-danger">
        <AlertTriangle size={22} strokeWidth={1.9} aria-hidden />
      </span>
      <h1 className="mt-4 text-[18px] font-semibold tracking-[-0.015em] text-fg-1">
        {routeName ? `${routeName} failed to load` : 'Something went wrong'}
      </h1>
      <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-fg-4">
        An unexpected error occurred. You can try again — if it keeps happening, reach out to
        support.
      </p>
      {error.digest ? (
        <p className="mt-1.5 text-[11px] text-fg-5">
          Reference: <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
      <button
        onClick={reset}
        className="mt-6 inline-flex items-center gap-2 rounded-xl border border-hairline bg-surface-1 px-4 py-2 text-[13px] font-medium text-fg-1 transition hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
      >
        <RotateCcw size={14} strokeWidth={1.9} aria-hidden />
        Try again
      </button>
    </div>
  );
}
