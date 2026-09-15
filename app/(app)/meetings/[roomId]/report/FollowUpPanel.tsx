"use client";

// The follow-up, editable and sendable.
//
// The report writes a ready-to-send email. Until this panel the only thing the
// product could do with it was put it on the clipboard, so the host opened
// another application, pasted it, and typed in the addresses of people this
// meeting already knows.
//
// Editable because a draft somebody cannot change before it goes out under
// their name is not a draft — and a host who has to copy it out to fix one
// sentence is back where they started.
import { useState } from "react";
import { CopyButton } from "./CopyButton";

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; sent: number; total: number }
  | { kind: "failed"; message: string };

export function FollowUpPanel({
  meetingId,
  draft,
  canSend,
}: {
  meetingId: string;
  draft: string;
  /** Only the host sends: it goes out over their name, to everyone in the room. */
  canSend: boolean;
}) {
  const [body, setBody] = useState(draft);
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<SendState>({ kind: "idle" });

  async function send() {
    setState({ kind: "sending" });
    try {
      const res = await fetch(`/api/meetings/${meetingId}/follow-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        sent?: number;
        total?: number;
        error?: string;
      };
      if (!res.ok) {
        setState({ kind: "failed", message: json.error ?? "The follow-up could not be sent." });
        return;
      }
      setState({ kind: "sent", sent: json.sent ?? 0, total: json.total ?? 0 });
    } catch {
      setState({ kind: "failed", message: "The follow-up could not be sent. Check your connection." });
    }
  }

  const sending = state.kind === "sending";

  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--fg-muted)]">
          Follow-up Draft
        </h2>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setEditing((v) => !v)}
            className="text-xs text-[var(--fg-muted)] hover:text-[var(--fg-secondary)] transition-colors"
          >
            {editing ? "Done" : "Edit"}
          </button>
          <CopyButton text={body} />
        </div>
      </div>

      {editing ? (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={Math.min(24, Math.max(8, body.split("\n").length + 1))}
          className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-3 text-sm leading-relaxed text-[var(--fg-primary)] focus:border-[var(--gold-400)] focus:outline-none"
        />
      ) : (
        <pre className="text-sm text-[var(--fg-primary)] whitespace-pre-wrap font-sans leading-relaxed">
          {body}
        </pre>
      )}

      {canSend && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-3">
          <button
            onClick={send}
            disabled={sending || !body.trim()}
            className="rounded-lg bg-[var(--gold-400)] px-3 py-1.5 text-xs font-semibold text-[#0d0d10] transition-opacity disabled:opacity-50"
          >
            {sending ? "Sending…" : state.kind === "sent" ? "Send again" : "Send to attendees"}
          </button>
          {/* What actually happened, in the terms the host cares about: how
              many of the people in the room heard from them. */}
          {state.kind === "sent" && (
            <p className="text-xs text-[var(--fg-muted)]">
              {state.sent === state.total
                ? `Sent to ${state.total} ${state.total === 1 ? "attendee" : "attendees"}.`
                : `Sent to ${state.sent} of ${state.total}. The rest could not be delivered.`}
            </p>
          )}
          {state.kind === "failed" && (
            <p className="text-xs text-[var(--status-danger,#ef4444)]">{state.message}</p>
          )}
          {state.kind === "idle" && (
            <p className="text-xs text-[var(--fg-muted)]">
              Goes to everyone on the meeting who has an email address, from your connected mailbox.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
