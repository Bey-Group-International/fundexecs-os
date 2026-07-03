"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useToast } from "./CoachingToast";

export interface ActionFormResult {
  ok: boolean;
  error?: string;
}

// A `<form action={...}>` bound directly to a server action (the pattern used
// throughout this codebase for inline add/edit forms) has no way to show the
// operator a failure — the action's return value is discarded and the form
// just... does nothing. This wraps the same action + fields in a client
// component that surfaces `result.error` inline when `result.ok` is false,
// without every call site needing its own local pending/error state.
//
// Outcomes also raise a toast (the shared confirmation surface): success uses
// `successMessage` (default "Saved" — pass null to suppress, e.g. when the
// form's own UI change already confirms it), failure always toasts alongside
// the inline error.
export function ActionForm({
  action,
  className,
  successMessage,
  children,
}: {
  action: (formData: FormData) => Promise<ActionFormResult>;
  className?: string;
  successMessage?: string | null;
  children: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();

  return (
    <form
      action={(formData: FormData) => {
        setError(null);
        start(async () => {
          const result = await action(formData);
          if (!result.ok) {
            const message = result.error ?? "Something went wrong.";
            setError(message);
            toast.error("Couldn't save", message);
            return;
          }
          if (successMessage !== null) toast.success(successMessage ?? "Saved");
        });
      }}
      className={className}
      aria-busy={pending}
    >
      {children}
      {error ? <p className="w-full text-[11px] text-status-danger">{error}</p> : null}
    </form>
  );
}
