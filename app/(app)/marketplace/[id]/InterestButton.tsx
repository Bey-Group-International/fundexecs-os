"use client";

import { useState, useTransition } from "react";

export function InterestButton({
  listingId,
  listingTitle,
  alreadyInterested,
  onExpressInterest,
}: {
  listingId: string;
  listingTitle: string;
  alreadyInterested: boolean;
  onExpressInterest: (id: string, title: string) => Promise<{ error?: string }>;
}) {
  const [done, setDone] = useState(alreadyInterested);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (done) return;
    startTransition(async () => {
      const res = await onExpressInterest(listingId, listingTitle);
      if (res?.error) setError(res.error);
      else setDone(true);
    });
  }

  if (done) {
    return (
      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-center text-sm text-emerald-300">
        Interest queued ✓
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleClick}
        disabled={pending}
        className="w-full rounded-md bg-gold-500 px-3 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-400 disabled:opacity-60"
      >
        {pending ? "Queuing…" : "Express interest"}
      </button>
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </div>
  );
}
