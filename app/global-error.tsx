'use client';

import { useEffect } from 'react';

/**
 * Root error boundary — catches errors thrown in the root layout itself, where
 * the normal `app/error.tsx` (which renders inside the layout) can't. It must
 * render its own <html>/<body>. Reports to Sentry when configured and shows a
 * clean branded fallback on a solid background.
 *
 * Because this replaces the whole document, the design tokens from globals.css
 * are referenced via their CSS variables with safe literal fallbacks, so the
 * fallback stays on-brand even if the stylesheet failed to load.
 */
export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
    void import('@sentry/nextjs').then((Sentry) => Sentry.captureException(error));
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
          background: 'var(--bg-1, #0a0f1c)',
          color: 'var(--fg-1, #e6edf6)',
          fontFamily:
            'var(--font-geist-sans, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif)'
        }}
      >
        <h1 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>Something went wrong</h1>
        <p
          style={{
            marginTop: '8px',
            maxWidth: '28rem',
            fontSize: '14px',
            color: 'var(--fg-4, #7a899e)'
          }}
        >
          A critical error occurred while loading the app. Please try again, and if it keeps
          happening reach out to support.
        </p>
        {error.digest ? (
          <p style={{ marginTop: '4px', fontSize: '12px', color: 'var(--fg-5, #7a899e)' }}>
            Reference: <span style={{ fontFamily: 'monospace' }}>{error.digest}</span>
          </p>
        ) : null}
        <div
          style={{
            marginTop: '24px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px'
          }}
        >
          <button
            onClick={reset}
            style={{
              borderRadius: '12px',
              border: '1px solid var(--border, rgba(255,255,255,0.1))',
              background: 'var(--surface-1, rgba(255,255,255,0.05))',
              color: 'var(--fg-1, #e6edf6)',
              padding: '8px 20px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer'
            }}
          >
            Try again
          </button>
          {/* Escape hatch — a hard navigation that fully reloads the document
              when the root layout keeps throwing on retry. A hard reload is the
              intent, so the next/link rule doesn't apply here. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              borderRadius: '12px',
              padding: '8px 20px',
              fontSize: '14px',
              fontWeight: 500,
              color: 'var(--fg-3, #9aa7ba)',
              textDecoration: 'none'
            }}
          >
            Back to home
          </a>
        </div>
      </body>
    </html>
  );
}
