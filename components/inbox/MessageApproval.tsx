"use client";

// components/inbox/MessageApproval.tsx — approving an inbox message in place.
//
// A reply (or proposed time, booking, meeting link, share) held for approval
// used to be a generic workflow card: a title, the description it was queued
// with, and a link to a workflow page. This card shows what will actually go
// out — to whom, under what subject, from which mailbox, on which conversation
// and meeting, after what the other side last said — and lets the approver:
//
//   - approve it as written, or edit it and approve the edit;
//   - send it back to Earn with a note, to come back revised;
//   - reject it;
//   - and, when an approved message failed to go out, retry it once the cause
//     is fixed (or discard it).
//
// A meeting's follow-up to several attendees is one group with Approve all /
// Reject all, and each person's copy still decided on its own when needed.

import { useState, useTransition } from "react";
import Link from "next/link";
import type { InboxItem } from "@/lib/inbox";
import type { InboxMessageApproval } from "@/lib/inbox/pending-action";
import { relativeTime } from "@/components/mobile/format";
import {
  approveEditedInboxMessage,
  decideInboxApproval,
  decideInboxApprovals,
  discardFailedInboxMessage,
  retryInboxMessage,
  type InboxApprovalDecision,
} from "@/app/(app)/inbox/actions";

type Mode = "idle" | "edit" | "revise" | "confirm";

const BTN = "rounded-md px-3 py-1 text-xs font-medium transition disabled:opacity-50";
const APPROVE = `${BTN} border border-status-success/45 bg-status-success/10 text-status-success hover:bg-status-success/20`;
const REJECT = `${BTN} border border-status-danger/40 bg-status-danger/[0.06] text-status-danger hover:bg-status-danger/15`;
const QUIET = `${BTN} border border-line text-fg-secondary hover:border-gold-500/40 hover:text-fg-primary`;

function Preview({ m }: { m: InboxMessageApproval }) {
  const to = m.to.name && m.to.email ? `${m.to.name} <${m.to.email}>` : (m.to.name ?? m.to.email ?? "—");
  return (
    <div className="rounded-lg border border-line/60 bg-surface-0/40 p-3 text-xs">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-fg-secondary">
        <dt className="text-fg-muted">To</dt>
        <dd className="min-w-0 break-words text-fg-primary">{to}</dd>
        {m.subject ? (
          <>
            <dt className="text-fg-muted">Subject</dt>
            <dd className="min-w-0 break-words">{m.subject}</dd>
          </>
        ) : null}
        <dt className="text-fg-muted">From</dt>
        <dd className="min-w-0 break-words">{m.from ?? "Your mailbox, or the organization's"}</dd>
      </dl>
      {m.body ? (
        <p className="mt-2 whitespace-pre-wrap border-t border-line/60 pt-2 leading-relaxed text-fg-primary">{m.body}</p>
      ) : m.sharePreface ? (
        <p className="mt-2 border-t border-line/60 pt-2 leading-relaxed text-fg-primary">{m.sharePreface}</p>
      ) : (
        <p className="mt-2 border-t border-line/60 pt-2 text-fg-muted">{m.actionLabel} — carried out on approval.</p>
      )}
    </div>
  );
}

function Context({ m }: { m: InboxMessageApproval }) {
  const who = [m.contact?.title, m.contact?.company].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col gap-1.5 text-[11px] text-fg-muted">
      {who ? <p>{who}</p> : null}
      {m.lastInbound ? (
        <p className="line-clamp-2">
          <span className="text-fg-secondary">They wrote {relativeTime(m.lastInbound.at)}:</span> “{m.lastInbound.body}”
        </p>
      ) : null}
      <p className="flex flex-wrap gap-3">
        <Link href={m.threadHref} className="text-gold-300 hover:underline">
          Open conversation →
        </Link>
        {m.meeting ? (
          <Link href={`/meetings/${m.meeting.roomCode}/report`} className="hover:text-fg-primary hover:underline">
            {m.meeting.title}
          </Link>
        ) : null}
      </p>
    </div>
  );
}

export function MessageApprovalCard({
  item,
  onDecided,
  onCleared,
  compact = false,
}: {
  item: InboxItem;
  onDecided: (id: string, decision: InboxApprovalDecision) => void;
  /** A failed message retried into success, or discarded. */
  onCleared: (id: string) => void;
  /** Inside a meeting group: the group already names the meeting. */
  compact?: boolean;
}) {
  const m = item.message!;
  const approval = item.approval;
  const [mode, setMode] = useState<Mode>("idle");
  const [draft, setDraft] = useState(m.body ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; notice?: string }>, after: () => void) => {
    setError(null);
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) {
          if (r.notice) setNotice(r.notice);
          after();
        } else setError(r.error ?? "That didn't work. Try again.");
      } catch {
        setError("Could not reach the server. Try again.");
      }
    });
  };

  const decide = (decision: InboxApprovalDecision, text?: string) =>
    approval && run(() => decideInboxApproval(approval.approvalId, decision, text), () => onDecided(item.id, decision));

  // Outward-facing by nature: an approve is one deliberate click, never a stray one.
  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="truncate text-sm font-medium text-fg-primary">
        {m.actionLabel} · {m.to.name ?? m.to.email ?? "contact"}
      </span>
      {m.failed ? (
        <span className="rounded-full border border-status-danger/45 bg-status-danger/10 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-status-danger">
          Not sent
        </span>
      ) : null}
      {!compact && m.meeting ? (
        <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-muted">{m.meeting.title}</span>
      ) : null}
    </div>
  );

  if (m.failed) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-line border-l-2 border-l-red-500/70 bg-surface-1 p-4">
        {header}
        <p className="text-xs text-status-danger">{m.failed.error}</p>
        <Preview m={m} />
        <Context m={m} />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            className={APPROVE}
            onClick={() => run(() => retryInboxMessage(m.taskId), () => onCleared(item.id))}
          >
            {busy ? "Sending…" : "Retry"}
          </button>
          <button
            type="button"
            disabled={busy}
            className={QUIET}
            onClick={() => run(() => discardFailedInboxMessage(m.taskId), () => onCleared(item.id))}
          >
            Discard
          </button>
          <Link href="/settings/integrations" className="ml-auto text-[11px] text-fg-muted hover:text-fg-primary">
            Check mailbox connection →
          </Link>
        </div>
        {error ? <p className="text-xs text-status-danger">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line border-l-2 border-l-gold-500/70 bg-surface-1 p-4">
      {header}
      {mode === "edit" ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          autoFocus
          aria-label="Edit the message"
          className="w-full resize-y rounded-lg border border-line bg-surface-0/70 p-2.5 text-xs text-fg-primary focus:border-gold-500/50 focus:outline-none"
        />
      ) : (
        <Preview m={m} />
      )}
      <Context m={m} />

      {!approval ? null : mode === "edit" ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !draft.trim()}
            className={APPROVE}
            onClick={() =>
              run(() => approveEditedInboxMessage(approval.approvalId, draft), () => onDecided(item.id, "approved"))
            }
          >
            {busy ? "Sending…" : "Approve & send edit"}
          </button>
          <button type="button" className={QUIET} onClick={() => setMode("idle")} disabled={busy}>
            Cancel
          </button>
        </div>
      ) : mode === "revise" ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) decide("regenerate", note.trim());
          }}
        >
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            autoFocus
            aria-label="What should change?"
            placeholder="What should change? e.g. Shorter, and propose Thursday instead."
            className="w-full resize-none rounded-lg border border-line bg-surface-0/70 p-2.5 text-xs text-fg-primary placeholder:text-fg-muted focus:border-gold-500/50 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button type="submit" className={QUIET} disabled={busy || !note.trim()}>
              {busy ? "Revising…" : "Send back to Earn"}
            </button>
            <button type="button" className={QUIET} onClick={() => setMode("idle")} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      ) : mode === "confirm" ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-xs text-fg-secondary">
            Send this to {m.to.name ?? m.to.email ?? "them"} now?
          </p>
          <button type="button" className={APPROVE} disabled={busy} onClick={() => decide("approved")}>
            {busy ? "Sending…" : "Yes, approve & send"}
          </button>
          <button type="button" className={QUIET} disabled={busy} onClick={() => setMode("idle")}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={APPROVE} disabled={busy} onClick={() => setMode("confirm")}>
            Approve
          </button>
          {m.editable ? (
            <button type="button" className={QUIET} disabled={busy} onClick={() => setMode("edit")}>
              Edit
            </button>
          ) : null}
          {m.editable ? (
            <button
              type="button"
              className={QUIET}
              disabled={busy}
              onClick={() => {
                setNote("");
                setMode("revise");
              }}
            >
              Send back to Earn
            </button>
          ) : null}
          <button type="button" className={REJECT} disabled={busy} onClick={() => decide("rejected")}>
            Reject
          </button>
        </div>
      )}
      {notice ? <p className="text-xs text-fg-secondary">{notice}</p> : null}
      {error ? <p className="text-xs text-status-danger">{error}</p> : null}
    </div>
  );
}

/** Items that share a meeting, in the order they arrived, so a follow-up batch reads as one. */
export function groupByMeeting(items: readonly InboxItem[]): Array<InboxItem | { meeting: NonNullable<InboxMessageApproval["meeting"]>; items: InboxItem[] }> {
  const groups = new Map<string, InboxItem[]>();
  for (const item of items) {
    const meeting = item.message && !item.message.failed && item.approval ? item.message.meeting : null;
    if (meeting) groups.set(meeting.id, [...(groups.get(meeting.id) ?? []), item]);
  }
  const placed = new Set<string>();
  const out: Array<InboxItem | { meeting: NonNullable<InboxMessageApproval["meeting"]>; items: InboxItem[] }> = [];
  for (const item of items) {
    const meeting = item.message && !item.message.failed && item.approval ? item.message.meeting : null;
    const group = meeting ? groups.get(meeting.id) : undefined;
    if (meeting && group && group.length > 1) {
      if (!placed.has(meeting.id)) {
        placed.add(meeting.id);
        out.push({ meeting, items: group });
      }
    } else {
      out.push(item);
    }
  }
  return out;
}

export function MeetingApprovalGroup({
  meeting,
  items,
  onDecided,
  onCleared,
}: {
  meeting: NonNullable<InboxMessageApproval["meeting"]>;
  items: InboxItem[];
  onDecided: (id: string, decision: InboxApprovalDecision) => void;
  onCleared: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<"approved" | "rejected" | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [busy, start] = useTransition();
  const people = items.map((i) => i.message!.to.name ?? i.message!.to.email ?? "contact");

  const decideAll = (decision: "approved" | "rejected") => {
    setConfirming(null);
    setFailures([]);
    start(async () => {
      const byApproval = new Map(items.map((i) => [i.approval!.approvalId, i]));
      try {
        const { results } = await decideInboxApprovals([...byApproval.keys()], decision);
        const failed: string[] = [];
        for (const r of results) {
          const item = byApproval.get(r.approvalId);
          if (!item) continue;
          if (r.ok) onDecided(item.id, decision);
          else failed.push(`${item.message!.to.name ?? item.message!.to.email}: ${r.error ?? "failed"}`);
        }
        setFailures(failed);
      } catch {
        setFailures(["Could not reach the server. Try again."]);
      }
    });
  };

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-line border-l-2 border-l-gold-500/70 bg-surface-1 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg-primary">
            {meeting.title} · {items.length} messages
          </p>
          <p className="truncate text-xs text-fg-secondary">To {people.join(", ")}</p>
        </div>
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-fg-secondary">
              {confirming === "approved" ? `Send all ${items.length}?` : `Reject all ${items.length}?`}
            </span>
            <button
              type="button"
              disabled={busy}
              className={confirming === "approved" ? APPROVE : REJECT}
              onClick={() => decideAll(confirming)}
            >
              Yes
            </button>
            <button type="button" className={QUIET} onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} className={APPROVE} onClick={() => setConfirming("approved")}>
              {busy ? "Working…" : "Approve all"}
            </button>
            <button type="button" disabled={busy} className={REJECT} onClick={() => setConfirming("rejected")}>
              Reject all
            </button>
            <button type="button" className="text-[11px] text-fg-muted hover:text-fg-primary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? "Hide" : "Review each"}
            </button>
          </div>
        )}
      </div>
      {failures.length > 0 ? (
        <p className="text-xs text-status-danger">Not sent — {failures.join("; ")}</p>
      ) : null}
      {open ? (
        <div className="mt-1 flex flex-col gap-2">
          {items.map((item) => (
            <MessageApprovalCard key={item.id} item={item} onDecided={onDecided} onCleared={onCleared} compact />
          ))}
        </div>
      ) : null}
    </section>
  );
}
