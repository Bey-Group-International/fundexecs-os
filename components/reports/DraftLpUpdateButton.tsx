"use client";

// Client island for the gated Earn handoff. Calls the `draftLpUpdate` server
// action, then surfaces the resulting plan title and a link into the new Earn
// session. Drafting only — sending is a Tier-2 action gated elsewhere. Imports
// only the action and react/next-link, so no server module enters the bundle.
import Link from "next/link";
import { useState, useTransition } from "react";
import { draftLpUpdate } from "./actions";

export function DraftLpUpdateButton({ period }: { period: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    sessionId?: string;
    planTitle?: string;
    error?: string;
  } | null>(null);

  function onClick() {
    setResult(null);
    startTransition(async () => {
      const r = await draftLpUpdate({ period });
      if (r.ok) {
        setResult({ sessionId: r.sessionId, planTitle: r.planTitle });
      } else {
        setResult({ error: r.error ?? "Something went wrong." });
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-gold-300 transition-colors hover:bg-gold-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Drafting…" : "Draft LP update"}
      </button>

      {result?.error ? (
        <p className="font-mono text-[10px] uppercase tracking-wider text-status-danger">
          {result.error}
        </p>
      ) : result?.sessionId ? (
        <div className="text-right">
          {result.planTitle ? (
            <p className="text-xs text-fg-secondary">{result.planTitle}</p>
          ) : null}
          <Link
            href={`/session/${result.sessionId}`}
            className="font-mono text-[10px] uppercase tracking-wider text-gold-300 underline-offset-2 hover:underline"
          >
            Open in Earn →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
