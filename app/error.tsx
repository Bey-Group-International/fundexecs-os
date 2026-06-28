"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function Error({
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
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
      <p className="font-mono text-[11px] uppercase tracking-widest text-fg-muted">
        Something went wrong
      </p>
      <p className="max-w-sm text-sm text-fg-secondary">
        An unexpected error occurred. The team has been notified automatically.
      </p>
      <button
        onClick={reset}
        className="rounded-md border border-line px-3 py-1.5 text-sm text-fg-secondary transition hover:border-gold-500/40 hover:text-gold-300"
      >
        Try again
      </button>
    </div>
  );
}
