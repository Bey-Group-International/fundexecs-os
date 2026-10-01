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
import { memo, useState } from "react";
import { deliveryMessage } from "@/lib/meetings/recipients";
import { FIRST_NAME_TOKEN, displayFollowUp } from "@/lib/meetings/follow-up-greeting";
import { CopyButton } from "./CopyButton";

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; sent: number; total: number; unreachable: string[]; failed: string[] }
  | { kind: "failed"; message: string }
  // Drafting is not a kind of sending, and sharing the state is what keeps the
  // two from being confused in the UI: "Drafted" must never read as "Sent".
  | { kind: "drafting" }
  | { kind: "drafted"; message: string };

/**
 * Memoised because the report page holds the recording's playhead in its own
 * state, and only the transcript reads it. Without this, every second of
 * playback re-rendered this component for nothing.
 *
 * Its props are the meeting id, the draft text and whether the viewer may send — none of which the playhead touches.
 */
export const FollowUpPanel = memo(function FollowUpPanel({
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

  /**
   * Put the follow-up in the inbox instead of in the post.
   *
   * The other half of this panel's job, and the half that matches how the rest of
   * the product treats an outward move: it becomes a draft on each attendee's own
   * thread, read in the context of everything else that person has said, and sent
   * by a person through the composer that is already gated. This press reaches
   * nobody.
   */
  async function draftInInbox() {
    setState({ kind: "drafting" });
    try {
      const res = await fetch(`/api/meetings/${meetingId}/follow-up/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setState({ kind: "failed", message: json.error ?? "The follow-up could not be drafted." });
        return;
      }
      setState({
        kind: "drafted",
        message: json.message ?? "Drafted in the inbox. Nothing has been sent.",
      });
    } catch {
      setState({
        kind: "failed",
        message: "The follow-up could not be drafted. Check your connection.",
      });
    }
  }

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
        unreachable?: string[];
        failed?: string[];
        error?: string;
      };
      if (!res.ok) {
        setState({ kind: "failed", message: json.error ?? "The follow-up could not be sent." });
        return;
      }
      setState({
        kind: "sent",
        sent: json.sent ?? 0,
        total: json.total ?? 0,
        unreachable: json.unreachable ?? [],
        failed: json.failed ?? [],
      });
    } catch {
      setState({ kind: "failed", message: "The follow-up could not be sent. Check your connection." });
    }
  }

  const sending = state.kind === "sending";
  const drafting = state.kind === "drafting";
  const busy = sending || drafting;

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
          <CopyButton text={displayFollowUp(body)} />
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

      {body.includes(FIRST_NAME_TOKEN) && (
        <p className="mt-2 text-xs text-[var(--fg-muted)]">
          <code className="text-[var(--fg-secondary)]">{FIRST_NAME_TOKEN}</code> is replaced with each
          recipient&rsquo;s first name, so everyone gets their own copy addressed to them.
        </p>
      )}

      {canSend && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-3">
          {/* Drafting first, and it is the primary of the two. Sending from here
              reaches everybody who was in the room the moment it is pressed;
              drafting puts the same words where they can be read in context,
              edited, and sent through the gate every other outward move goes
              through. The louder button should be the reversible one. */}
          <button
            onClick={draftInInbox}
            disabled={busy || !body.trim()}
            className="rounded-lg bg-[var(--gold-400)] px-3 py-1.5 text-xs font-semibold text-[#0d0d10] transition-opacity disabled:opacity-50"
          >
            {drafting ? "Drafting…" : state.kind === "drafted" ? "Draft again" : "Draft in inbox"}
          </button>
          <button
            onClick={send}
            disabled={busy || !body.trim()}
            className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--fg-primary)] transition-opacity disabled:opacity-50"
          >
            {sending ? "Sending…" : state.kind === "sent" ? "Send again" : "Send now"}
          </button>
          {/* What actually happened, in the terms the host cares about: which of
              the people in the room heard from them, which addresses bounced,
              and who has no address here at all. The last of those was missing —
              the count was of addresses, so a meeting where two people joined as
              guests reported itself fully sent. */}
          {state.kind === "sent" && (
            <p className="text-xs text-[var(--fg-muted)]">
              {deliveryMessage({
                sent: state.sent,
                total: state.total,
                unreachable: state.unreachable,
                failed: state.failed,
              })}
            </p>
          )}
          {state.kind === "drafted" && (
            <p className="text-xs text-[var(--fg-muted)]">
              {state.message}{" "}
              <a href="/inbox" className="text-[var(--gold-400)] hover:underline">
                Open inbox
              </a>
            </p>
          )}
          {state.kind === "failed" && (
            <p className="text-xs text-[var(--status-danger,#ef4444)]">{state.message}</p>
          )}
          {state.kind === "idle" && (
            <p className="text-xs text-[var(--fg-muted)]">
              Drafting puts it on each attendee&rsquo;s inbox thread for someone to send. Sending now
              goes straight to everyone who was invited or in the room and has an email address
              here, from your connected mailbox — not to you.
            </p>
          )}
        </div>
      )}
    </section>
  );
});
