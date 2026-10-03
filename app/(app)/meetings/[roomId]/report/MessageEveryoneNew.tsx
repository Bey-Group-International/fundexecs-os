"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FIRST_NAME_TOKEN,
  conversationProblem,
  groupTemplate,
  personalizeGroupBody,
} from "@/lib/meetings/conversation";
import { startConversation } from "./conversation-actions";

// "Message everyone new": one composer for every attendee the inbox has never
// heard from. Each person still gets their own thread, linked to the meeting,
// with their own first name in the greeting — the text is written once and sent
// as N separate conversations, each through the inbox's gates. Sequential, so a
// failure for one person is reported by name and never stops the rest.

interface Person {
  name: string;
  email: string;
}

type Outcome = { email: string; name: string; ok: boolean; gated?: boolean; error?: string };

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
  const [progress, setProgress] = useState<number | null>(null);
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
    const results: Outcome[] = [];
    for (let i = 0; i < people.length; i++) {
      setProgress(i);
      const person = people[i];
      const fd = new FormData();
      fd.set("meeting_id", meetingId);
      fd.set("email", person.email);
      fd.set("subject", subject);
      fd.set("body", personalizeGroupBody(body, person.name));
      try {
        const r = await startConversation(fd);
        results.push(
          r.ok
            ? { email: person.email, name: person.name, ok: true, gated: r.gated }
            : { email: person.email, name: person.name, ok: false, error: r.error },
        );
      } catch {
        results.push({ email: person.email, name: person.name, ok: false, error: "Could not reach the server." });
      }
    }
    setProgress(null);
    setOutcomes(results);
    setOpen(false);
    router.refresh();
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

  const sending = progress !== null;
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
      {error && <p className="text-xs text-[var(--status-danger)]">{error}</p>}
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
          {sending ? `Sending ${progress! + 1} of ${people.length}…` : `Send to ${people.length}`}
        </button>
      </div>
    </div>
  );
}
