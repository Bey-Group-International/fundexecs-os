"use client";

// Uploads recording parts this device kept when it could not upload them —
// a dropped connection, a closed laptop — the next time a meetings page opens
// with a connection, and again whenever the browser comes back online. See
// lib/meetings/recording-outbox.ts. Says one line when it has done something,
// and nothing otherwise.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { drainOutbox, idbOutbox, type OutboxStore } from "@/lib/meetings/recording-outbox";

export function RecordingRecovery({ store }: { store?: OutboxStore | null }) {
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const outbox = store === undefined ? idbOutbox() : store;
    if (!outbox) return;
    let busy = false;
    let live = true;
    const drain = async () => {
      if (busy || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
      busy = true;
      try {
        const result = await drainOutbox(createClient(), outbox);
        if (live && result.uploaded > 0) {
          setNote(
            `Uploaded ${result.uploaded} saved part${result.uploaded === 1 ? "" : "s"} of an earlier recording${
              result.kept ? ` — ${result.kept} still waiting for a connection` : ""
            }.`,
          );
        }
      } finally {
        busy = false;
      }
    };
    void drain();
    window.addEventListener("online", drain);
    return () => {
      live = false;
      window.removeEventListener("online", drain);
    };
  }, [store]);

  if (!note) return null;
  return (
    <p role="status" className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-1 px-3 py-2 text-xs text-fg-secondary">
      <span>{note}</span>
      <button type="button" onClick={() => setNote(null)} className="text-fg-muted hover:text-fg-primary">
        Dismiss
      </button>
    </p>
  );
}
