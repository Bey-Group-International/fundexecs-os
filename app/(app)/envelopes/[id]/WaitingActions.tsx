"use client";

// Step 2 of the wizard: the reader has their link. Resend it, or copy it to send another way.
import { useState, useTransition } from "react";

export function WaitingActions({ envelopeId, readerName, signingToken }: { envelopeId: string; readerName: string; signingToken: string | null }) {
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function resend() {
    setMessage(null);
    startTransition(async () => {
      const res = await fetch(`/api/envelopes/${envelopeId}/resend`, { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; sentTo?: string[] };
      setMessage(res.ok && j.ok ? { kind: "ok", text: `Sent again to ${j.sentTo?.join(", ") ?? readerName}.` } : { kind: "error", text: j.error ?? "Could not send the reminder." });
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/sign/${signingToken}`);
      setMessage({ kind: "ok", text: "Link copied." });
    } catch {
      setMessage({ kind: "error", text: "Could not copy the link." });
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <button type="button" onClick={resend} disabled={pending} className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 text-sm text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50">
        {pending ? "Sending…" : `Resend to ${readerName}`}
      </button>
      {signingToken ? (
        <button type="button" onClick={copy} className="rounded-lg border border-line px-3 py-1.5 text-sm text-fg-secondary transition hover:bg-surface-2">
          Copy link
        </button>
      ) : null}
      {message ? (
        <span role={message.kind === "error" ? "alert" : "status"} className={`text-xs ${message.kind === "error" ? "text-status-danger" : "text-fg-secondary"}`}>
          {message.text}
        </span>
      ) : null}
    </div>
  );
}
