"use client";

import { useTransition } from "react";
import { openBillingPortalAction } from "./actions";

export function BillingPortalButton() {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await openBillingPortalAction();
      if (result?.error) {
        alert(result.error);
      }
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className="rounded-lg border border-neural-400/30 bg-surface-2/40 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-fg-secondary transition hover:border-neural-400/60 hover:text-fg-primary disabled:opacity-50"
    >
      {pending ? "Opening…" : "Manage subscription →"}
    </button>
  );
}
