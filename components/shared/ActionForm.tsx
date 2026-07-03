"use client";

import { useState, useTransition, type ReactNode } from "react";

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
export function ActionForm({
  action,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<ActionFormResult>;
  className?: string;
  children: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      action={(formData: FormData) => {
        setError(null);
        start(async () => {
          const result = await action(formData);
          if (!result.ok) setError(result.error ?? "Something went wrong.");
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
