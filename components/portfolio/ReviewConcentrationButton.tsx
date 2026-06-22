"use client";

// A small client island that hands the portfolio's concentration picture to
// Earn. It routes the ask (the standing approval loop still gates any outward
// action) and, on success, surfaces the routed plan with a link into the
// session. Imports only the server action, so it never pulls server-only code
// into the client bundle.
import { useState, useTransition } from "react";
import Link from "next/link";
import { reviewConcentration, type HandoffResult } from "@/components/portfolio/actions";

export function ReviewConcentrationButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<HandoffResult | null>(null);

  function run() {
    setResult(null);
    startTransition(async () => {
      setResult(await reviewConcentration());
    });
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
      >
        {pending ? "Routing to Earn…" : "Have Earn review concentration"}
      </button>
      {result?.ok && result.sessionId ? (
        <Link
          href={`/session/${result.sessionId}`}
          className="text-xs text-fg-secondary underline-offset-2 hover:text-fg-primary hover:underline"
        >
          {result.planTitle ?? "Plan ready"} — open session →
        </Link>
      ) : null}
      {result && !result.ok ? (
        <span className="text-xs text-status-danger">{result.error}</span>
      ) : null}
    </div>
  );
}
