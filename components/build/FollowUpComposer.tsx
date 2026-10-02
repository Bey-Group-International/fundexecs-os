"use client";

import { useState, useTransition } from "react";
import { draftInvestorFollowUp, sendInvestorFollowUp } from "./follow-up-actions";

/**
 * Earn drafts a follow-up to one reader; the operator edits it and sends it
 * from their own mailbox. Nothing goes out without the Send click.
 */
export function FollowUpComposer({ roomId, viewerKey, emphasis }: { roomId: string; viewerKey: string; emphasis: boolean }) {
  const [draft, setDraft] = useState<{ to: string; subject: string; body: string; source: "earn" | "template" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [drafting, startDraft] = useTransition();
  const [sending, startSend] = useTransition();
  const field = "w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary focus:border-gold-500/60 focus:outline-none";

  if (sent) return <p role="status" className="text-xs text-emerald-300">Sent. It&apos;s on their record and logged here.</p>;

  if (!draft) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={drafting}
          onClick={() =>
            startDraft(async () => {
              setError(null);
              const res = await draftInvestorFollowUp(roomId, viewerKey).catch(() => ({ ok: false as const, error: "Earn couldn't draft. Try again." }));
              if (res.ok) setDraft({ to: res.to, ...res.draft });
              else setError(res.error);
            })
          }
          className={`rounded-lg border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition disabled:opacity-50 ${
            emphasis
              ? "border-gold-500/40 bg-gold-500/10 text-gold-300 hover:bg-gold-500/20"
              : "border-line text-fg-muted hover:text-fg-secondary"
          }`}
        >
          {drafting ? "Earn is drafting…" : "Draft follow-up"}
        </button>
        {error ? (
          <span role="alert" className="text-[11px] text-amber-400">
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface-0/60 p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        To {draft.to} · {draft.source === "earn" ? "drafted by Earn" : "starter draft"} · edit before sending
      </p>
      <input
        aria-label="Subject"
        value={draft.subject}
        onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
        className={field}
      />
      <textarea
        aria-label="Message"
        rows={8}
        value={draft.body}
        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        className={`${field} resize-y leading-relaxed`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={sending || !draft.subject.trim() || !draft.body.trim()}
          onClick={() =>
            startSend(async () => {
              setError(null);
              const res = await sendInvestorFollowUp(roomId, viewerKey, draft.subject, draft.body).catch(() => ({
                ok: false as const,
                error: "Couldn't send. Try again.",
              }));
              if (res.ok) setSent(true);
              else setError(res.error);
            })
          }
          className="rounded-lg bg-gold-400 px-4 py-1.5 text-sm font-medium text-on-gold transition hover:bg-gold-300 disabled:opacity-60"
        >
          {sending ? "Sending…" : "Send from my email"}
        </button>
        <button type="button" onClick={() => setDraft(null)} className="text-xs text-fg-muted hover:text-fg-secondary">
          Discard
        </button>
        {error ? (
          <span role="alert" className="text-[11px] text-amber-400">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}
