"use client";

// Inline feedback for the room server actions.
//
// Those actions throw when a write fails (see room-actions.ts), which is the
// right contract: a failed withdrawal must never look like a successful one.
// But an uncaught rejection from a client transition lands in the route's
// error boundary and replaces the whole page. This hook catches it at the call
// site instead, so the control that failed says so, next to where the operator
// clicked, and the rest of the page keeps working.
//
// The message is fixed text chosen by the caller. In production Next.js redacts
// the message of an error thrown from a server action, so there is no real
// reason to show; "try again" is the honest thing to say.
//
// Some actions (review-actions.ts) report failure by RETURNING
// `{ ok: false, error }` instead of throwing. That is a failure too, and its
// `error` is returned data, not a redacted exception, so it is shown as is.
import { useCallback, useState } from "react";

function failedResult(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as { ok?: unknown; error?: unknown };
  return v.ok === false ? (typeof v.error === "string" && v.error ? v.error : "") : null;
}

export function useActionError() {
  const [error, setError] = useState<string | null>(null);

  /** Run an action. Resolves true on success; on failure sets `message` and resolves false. */
  const run = useCallback(async (action: () => Promise<unknown>, message: string): Promise<boolean> => {
    setError(null);
    try {
      const result = await action();
      const failed = failedResult(result);
      if (failed !== null) {
        setError(failed || message);
        return false;
      }
      return true;
    } catch {
      setError(message);
      return false;
    }
  }, []);

  const clear = useCallback(() => setError(null), []);

  return { error, run, clear };
}

export function ActionError({ message, className = "" }: { message: string | null; className?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className={`text-xs text-status-danger ${className}`}>
      {message}
    </p>
  );
}
