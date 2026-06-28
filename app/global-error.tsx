"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface-0 text-center text-fg-primary">
        <p className="font-mono text-[11px] uppercase tracking-widest text-fg-muted">
          Critical error
        </p>
        <p className="max-w-sm text-sm text-fg-secondary">
          Something went wrong at the application level. The team has been notified.
        </p>
        <button
          onClick={reset}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-fg-secondary"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
