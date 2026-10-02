"use client";

import { useState, useTransition } from "react";
import { refreshEngagementReads } from "./engagement-actions";

/** Ask Earn to read every investor's engagement in this room. */
export function AskEarnButton({ roomId, hasReads }: { roomId: string; hasReads: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const res = await refreshEngagementReads(roomId).catch(() => ({ ok: false, error: "Earn couldn't run. Try again." }));
            if (!res.ok) setMessage(res.error ?? "Earn couldn't run. Try again.");
          })
        }
        className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
      >
        {pending ? "Earn is reading…" : hasReads ? "Refresh Earn's read" : "Ask Earn to read interest"}
      </button>
      {message ? (
        <p role="alert" className="text-[11px] text-amber-400">
          {message}
        </p>
      ) : null}
    </div>
  );
}
