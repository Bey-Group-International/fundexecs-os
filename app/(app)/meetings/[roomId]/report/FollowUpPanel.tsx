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
//
// What it shows before anything is sent is the point of its layout: who the
// email is to (and in what role), who it cannot reach, and exactly what each
// recipient will read — their own name in the greeting, the formatting as it
// will render. Pressing Send used to be the first time the host learnt any of
// that.
import { memo, useMemo, useRef, useState } from "react";
import { deliveryMessage } from "@/lib/meetings/recipients";
import { FIRST_NAME_TOKEN, displayFollowUp, personalizeFollowUp } from "@/lib/meetings/follow-up-greeting";
import { followUpBlocks, toggleList, wrapSelection, type Edit } from "@/lib/meetings/follow-up-format";
import {
  followUpStateLabel,
  type FollowUpState,
  type ReportParticipant,
} from "@/lib/meetings/report-participants";
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

const ROLE_LABEL: Record<ReportParticipant["role"], string> = {
  host: "Host",
  invitee: "Invitee",
  attendee: "Attendee",
};

/** The chip's colour follows the state, so "Not sent" reads as something to do. */
export function FollowUpStatusChip({ state }: { state: FollowUpState }) {
  const tone =
    state.kind === "sent"
      ? "bg-[var(--status-success)]/15 text-[var(--status-success)]"
      : state.kind === "drafted"
        ? "bg-[var(--gold-400)]/15 text-[var(--gold-400)]"
        : state.kind === "not_sent"
          ? "bg-[var(--status-warning,#f59e0b)]/15 text-[var(--status-warning,#f59e0b)]"
          : "bg-[var(--surface-3)] text-[var(--fg-muted)]";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {followUpStateLabel(state)}
    </span>
  );
}

/** The draft as it will render, for one reader. */
function RenderedFollowUp({ body }: { body: string }) {
  const blocks = useMemo(() => followUpBlocks(body), [body]);
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed text-[var(--fg-primary)]">
      {blocks.map((block, i) =>
        block.kind === "p" ? (
          // Escaped by followUpBlocks before any tag is added; see follow-up-format.ts.
          <p key={i} dangerouslySetInnerHTML={{ __html: block.html }} />
        ) : block.kind === "ul" ? (
          <ul key={i} className="list-disc pl-5 flex flex-col gap-1">
            {block.items.map((item, j) => (
              <li key={j} dangerouslySetInnerHTML={{ __html: item }} />
            ))}
          </ul>
        ) : (
          <ol key={i} className="list-decimal pl-5 flex flex-col gap-1">
            {block.items.map((item, j) => (
              <li key={j} dangerouslySetInnerHTML={{ __html: item }} />
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

const TOOLBAR: Array<{ label: string; title: string; apply: (t: string, s: number, e: number) => Edit; className?: string }> = [
  { label: "B", title: "Bold", apply: (t, s, e) => wrapSelection(t, s, e, "**"), className: "font-bold" },
  { label: "I", title: "Italic", apply: (t, s, e) => wrapSelection(t, s, e, "_"), className: "italic" },
  { label: "• List", title: "Bulleted list", apply: (t, s, e) => toggleList(t, s, e, "ul") },
  { label: "1. List", title: "Numbered list", apply: (t, s, e) => toggleList(t, s, e, "ol") },
];

/**
 * Memoised because the report page holds the recording's playhead in its own
 * state, and only the transcript reads it. Without this, every second of
 * playback re-rendered this component for nothing.
 */
export const FollowUpPanel = memo(function FollowUpPanel({
  meetingId,
  draft,
  canSend,
  recipients = [],
  unreachable = [],
  hostName = null,
  status = { kind: "not_sent" },
}: {
  meetingId: string;
  draft: string;
  /** Only the host sends: it goes out over their name, to everyone in the room. */
  canSend: boolean;
  /** Who the follow-up reaches, with the role each was in the meeting in. */
  recipients?: ReportParticipant[];
  /** People in the meeting it cannot reach: no address here. */
  unreachable?: string[];
  /** To recognise a stored greeting that names the host. */
  hostName?: string | null;
  status?: FollowUpState;
}) {
  const [body, setBody] = useState(draft);
  const [editing, setEditing] = useState(false);
  const [previewAs, setPreviewAs] = useState(0);
  const [state, setState] = useState<SendState>({ kind: "idle" });
  const field = useRef<HTMLTextAreaElement>(null);

  const reader = recipients[previewAs] ?? null;
  const preview = reader
    ? personalizeFollowUp(body, reader.name, { hostName })
    : displayFollowUp(body);

  function format(apply: (t: string, s: number, e: number) => Edit) {
    const el = field.current;
    if (!el) return;
    const edit = apply(body, el.selectionStart, el.selectionEnd);
    setBody(edit.text);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(edit.start, edit.end);
    });
  }

  /**
   * Put the follow-up in the inbox instead of in the post.
   *
   * It becomes a draft on each attendee's own thread, read in the context of
   * everything else that person has said, and sent by a person through the
   * composer that is already gated. This press reaches nobody.
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
  // What just happened here outranks what the page was rendered with.
  const shownStatus: FollowUpState =
    state.kind === "sent" && state.sent === state.total && state.unreachable.length === 0
      ? { kind: "sent" }
      : state.kind === "drafted"
        ? { kind: "drafted", threads: status.kind === "drafted" ? status.threads : 1 }
        : status;

  return (
    <section
      id="follow-up"
      className="scroll-mt-6 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 sm:p-5 flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]">
            Follow-up email
          </h2>
          <FollowUpStatusChip state={shownStatus} />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {canSend && (
            <div className="flex rounded-lg border border-[var(--line)] p-0.5 text-xs">
              <button
                aria-pressed={editing}
                onClick={() => setEditing(true)}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  editing ? "bg-[var(--surface-3)] text-[var(--fg-primary)]" : "text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
                }`}
              >
                Edit
              </button>
              <button
                aria-pressed={!editing}
                onClick={() => setEditing(false)}
                className={`rounded-md px-2.5 py-1 transition-colors ${
                  !editing ? "bg-[var(--surface-3)] text-[var(--fg-primary)]" : "text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
                }`}
              >
                Preview
              </button>
            </div>
          )}
          <CopyButton text={displayFollowUp(body)} />
        </div>
      </div>

      {/* Who it is to — before Send, not after. */}
      {(recipients.length > 0 || unreachable.length > 0) && (
        <div className="flex flex-col gap-2 text-xs">
          {recipients.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[var(--fg-muted)] mr-1">To</span>
              {recipients.map((r) => (
                <span
                  key={r.email ?? r.name}
                  title={r.email ?? undefined}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface-0)] px-2 py-0.5 text-[var(--fg-primary)]"
                >
                  {r.name}
                  <span className="text-[10px] text-[var(--fg-muted)]">{ROLE_LABEL[r.role]}</span>
                </span>
              ))}
            </div>
          )}
          {unreachable.length > 0 && (
            <p className="text-[var(--status-warning,#f59e0b)]">
              No email address for {unreachable.join(", ")} — they won&rsquo;t receive it from here.
            </p>
          )}
        </div>
      )}

      {editing && canSend ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Formatting">
            {TOOLBAR.map((tool) => (
              <button
                key={tool.title}
                type="button"
                title={tool.title}
                aria-label={tool.title}
                onClick={() => format(tool.apply)}
                className={`rounded-md border border-[var(--line)] px-2 py-1 text-xs text-[var(--fg-secondary)] hover:bg-[var(--surface-2)] ${tool.className ?? ""}`}
              >
                {tool.label}
              </button>
            ))}
          </div>
          <textarea
            ref={field}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={Math.min(24, Math.max(10, body.split("\n").length + 1))}
            className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-3 font-mono text-[13px] leading-relaxed text-[var(--fg-primary)] focus:border-[var(--gold-400)] focus:outline-none"
          />
          {body.includes(FIRST_NAME_TOKEN) && (
            <p className="text-xs text-[var(--fg-muted)]">
              <code className="text-[var(--fg-secondary)]">{FIRST_NAME_TOKEN}</code> is replaced with
              each recipient&rsquo;s first name, so everyone gets their own copy addressed to them.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {recipients.length > 1 && (
            <label className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
              Preview as
              <select
                value={previewAs}
                onChange={(e) => setPreviewAs(Number(e.target.value))}
                className="rounded-md border border-[var(--line)] bg-[var(--surface-0)] px-2 py-1 text-xs text-[var(--fg-primary)]"
              >
                {recipients.map((r, i) => (
                  <option key={r.email ?? r.name} value={i}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-0)] p-4">
            <RenderedFollowUp body={preview} />
          </div>
        </div>
      )}

      {canSend && (
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-3">
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
            {sending
              ? "Sending…"
              : state.kind === "sent"
                ? "Send again"
                : recipients.length
                  ? `Send now to ${recipients.length}`
                  : "Send now"}
          </button>
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
            <p role="alert" className="text-xs text-[var(--status-danger,#ef4444)]">
              {state.message}
            </p>
          )}
          {state.kind === "idle" && (
            <p className="text-xs text-[var(--fg-muted)]">
              Drafting puts it on each recipient&rsquo;s inbox thread for someone to send. Sending now
              goes straight to them from your connected mailbox — not to you.
            </p>
          )}
        </div>
      )}
    </section>
  );
});
