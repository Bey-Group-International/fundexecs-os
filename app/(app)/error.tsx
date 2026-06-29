"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error-boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface-1 p-8 text-center">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-status-danger/40 bg-status-danger/10 text-status-danger">
          !
        </div>
        <h2 className="text-sm font-semibold text-fg-primary">Something went wrong</h2>
        <p className="mt-2 text-xs text-fg-secondary">
          {error.message || "An unexpected error occurred. Please try again."}
        </p>
        {error.digest ? (
          <p className="mt-1 font-mono text-[10px] text-fg-muted">ref: {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-lg border border-line bg-surface-2 px-4 py-2 text-xs text-fg-primary transition hover:border-gold-500/40 hover:text-gold-300"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
