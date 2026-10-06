"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FIRST_NAME_TOKEN, conversationProblem, groupTemplate } from "@/lib/meetings/conversation";
import { startConversations, type BatchOutcome } from "./conversation-actions";

// "Message everyone new": one composer for every attendee the inbox has never
// heard from. Each person still gets their own thread, linked to the meeting,
// with their own first name in the greeting — the text is written once and sent
// as N separate conversations, each through the inbox's gates. One server call
// does the lot (startConversations), and a failure for one person is reported by
// name without stopping the rest.

interface Person {
  name: string;
  email: string;
}

type Outcome = BatchOutcome;

export function MessageEveryoneNew({
  meetingId,
  meetingTitle,
  people,
  actionItems,
}: {
  meetingId: string;
  meetingTitle: string | null;
  people: readonly Person[];
  actionItems: readonly string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsMailbox, setNeedsMailbox] = useState(false);
  const [sending, setSending] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);

  if (people.length < 2) return null;

  function openComposer() {
    const t = groupTemplate({ meetingTitle, actionItems });
    setSubject(t.subject);
    setBody(t.body);
    setError(null);
    setOutcomes(null);
    setOpen(true);
  }

  async function sendAll() {
    const problem = conversationProblem({ subject, body });
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setNeedsMailbox(false);
    setSending(true);
    try {
      const r = await startConversations({
        meetingId,
        subject,
        body,
        emails: people.map((p) => p.email),
      });
      if (!r.ok) {
        setError(r.error);
        setNeedsMailbox(Boolean(r.needsMailbox));
        return;
      }
      // The server knows names from the attendee list; fall back to ours.
      const names = new Map(people.map((p) => [p.email.toLowerCase(), p.name]));
      setOutcomes(r.results.map((o) => ({ ...o, name: o.name || names.get(o.email.toLowerCase()) || "" })));
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSending(false);
    }
  }

  if (outcomes) {
    const ok = outcomes.filter((o) => o.ok);
    const gated = ok.filter((o) => o.gated).length;
    const failed = outcomes.filter((o) => !o.ok);
    return (
      <div className="mt-2 text-xs text-[var(--fg-muted)]">
        <p>
          {gated > 0
            ? `${gated} of ${outcomes.length} waiting in approvals`
            : `Sent to ${ok.length} of ${outcomes.length}`}
          .{" "}
          <Link href="/inbox" className="text-[var(--gold-400)] hover:underline">
            Open inbox →
          </Link>
        </p>
        {failed.length > 0 && (
          <p className="text-[var(--status-danger)]">
            Not sent to {failed.map((f) => `${f.name || f.email} (${f.error ?? "failed"})`).join(", ")}.
          </p>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openComposer}
        className="mt-2 rounded-md border border-[var(--gold-400)]/40 px-2.5 py-1 text-xs text-[var(--gold-400)] transition-colors hover:border-[var(--gold-400)]"
      >
        Message everyone new ({people.length})
      </button>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-1)] p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-[var(--fg-muted)]">
        To {people.length} people, each on their own thread
      </p>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        aria-label="Subject"
        className="rounded-md border border-[var(--line)] bg-[var(--surface-0)] px-2 py-1 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--gold-400)]"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label="Message"
        rows={6}
        className="resize-y rounded-md border border-[var(--line)] bg-[var(--surface-0)] px-2 py-1.5 text-sm text-[var(--fg-primary)] outline-none focus:border-[var(--gold-400)]"
      />
      <p className="text-[11px] text-[var(--fg-muted)]">
        {FIRST_NAME_TOKEN} becomes each person&apos;s first name.
      </p>
      {error && (
        <p className="text-xs text-[var(--status-danger)]">
          {error}
          {needsMailbox && (
            <>
              {" "}
              <Link href="/settings/integrations" className="underline underline-offset-2">
                Connect Gmail to send →
              </Link>
            </>
          )}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={sending}
          className="text-xs text-[var(--fg-muted)] hover:text-[var(--fg-primary)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={sendAll}
          disabled={sending || !body.trim()}
          className="rounded-md border border-[var(--line)] bg-[var(--surface-0)] px-2.5 py-1 text-xs text-[var(--fg-primary)] hover:border-[var(--gold-400)] disabled:opacity-50"
        >
          {sending ? `Sending to ${people.length}…` : `Send to ${people.length}`}
        </button>
      </div>
    </div>
  );
}
