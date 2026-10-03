"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { conversationProblem, conversationTemplate } from "@/lib/meetings/conversation";
import { draftConversation, startConversation } from "./conversation-actions";

// "Start conversation" beside an attendee on the meeting report.
//
// Opens a composer in place, seeded from the report with no model call; "Draft
// with Earn" asks the small model only when pressed. Sending creates (or reuses)
// the inbox thread with this person, linked to the meeting, and goes out through
// the inbox's own gates — so it may land in approvals rather than send at once,
// and the composer says which.

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "sent"; message: string; gated: boolean; subject: string };

export function StartConversation({
  meetingId,
  meetingTitle,
  recipient,
  actionItems,
}: {
  meetingId: string;
  meetingTitle: string | null;
  recipient: { name: string; email: string };
  actionItems: readonly string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [drafting, startDraft] = useTransition();
  const [sending, startSend] = useTransition();

  function openComposer() {
    // Seeded once, on open, from what the page already holds: free and instant.
    const t = conversationTemplate({ meetingTitle, recipientName: recipient.name, actionItems });
    setSubject(t.subject);
    setBody(t.body);
    setStatus({ kind: "idle" });
    setOpen(true);
  }

  function draftWithEarn() {
    startDraft(async () => {
      const r = await draftConversation(meetingId, recipient.email);
      if (!r.ok) {
        setStatus({ kind: "error", message: r.error });
        return;
      }
      setSubject(r.subject);
      setBody(r.body);
      setStatus(r.live ? { kind: "idle" } : { kind: "error", message: "Earn is unavailable; kept the template." });
    });
  }

  function send() {
    const problem = conversationProblem({ subject, body });
    if (problem) {
      setStatus({ kind: "error", message: problem });
      return;
    }
    startSend(async () => {
      const fd = new FormData();
      fd.set("meeting_id", meetingId);
      fd.set("email", recipient.email);
      fd.set("subject", subject);
      fd.set("body", body);
      const r = await startConversation(fd);
      if (!r.ok) {
        setStatus({ kind: "error", message: r.error });
        return;
      }
      setStatus({ kind: "sent", message: r.message, gated: r.gated, subject });
      setOpen(false);
      // The new thread belongs in the history above; re-read it.
      router.refresh();
    });
  }

  if (status.kind === "sent") {
    return (
      <p className="mt-2 text-xs text-[var(--fg-muted)]">
        {status.message}{" "}
        <Link
          href={status.gated ? "/inbox" : `/inbox?q=${encodeURIComponent(status.subject)}`}
          className="text-[var(--gold-400)] hover:underline"
        >
          {status.gated ? "Review in approvals →" : "Open in inbox →"}
        </Link>
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openComposer}
        className="mt-2 rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-[var(--fg-secondary)] transition-colors hover:border-[var(--gold-400)] hover:text-[var(--fg-primary)]"
      >
        Start conversation
      </button>
    );
  }

  const busy = drafting || sending;
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-1)] p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-[var(--fg-muted)]">
        To {recipient.name && recipient.name !== recipient.email ? `${recipient.name} · ` : ""}
        {recipient.email}
      </p>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        aria-label="Subject"
        placeholder="Subject"
        className="rounded-md border border-[var(--line)] bg-[var(--surface-0)] px-2 py-1 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--gold-400)]"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label="Message"
        rows={6}
        className="resize-y rounded-md border border-[var(--line)] bg-[var(--surface-0)] px-2 py-1.5 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--gold-400)]"
      />
      {status.kind === "error" && <p className="text-xs text-[var(--status-danger)]">{status.message}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--fg-muted)]">Goes through your inbox · approvals if required</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="text-xs text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={draftWithEarn}
            disabled={busy}
            className="rounded-md border border-[var(--gold-400)]/40 px-2.5 py-1 text-xs text-[var(--gold-400)] disabled:opacity-50"
          >
            {drafting ? "Drafting…" : "✦ Draft with Earn"}
          </button>
          <button
            type="button"
            onClick={send}
            disabled={busy || !body.trim()}
            className="rounded-md border border-[var(--line)] bg-[var(--surface-0)] px-2.5 py-1 text-xs text-[var(--fg-primary)] hover:border-[var(--gold-400)] disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
