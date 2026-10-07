// lib/inbox/pending-action.ts
// An inbox action held for approval, as it is recorded on its task — and the
// pure helpers that read it back. No I/O, so the inbox list, the approval card
// and the delivery path all read the same shape the same way.

import type { ActionKind } from "@/lib/gates";
import { INBOX_ACTION_LABEL } from "@/lib/inbox/action-labels";

export type BackingArtifact = { verification_status: string; grounding_score: number };

/**
 * An inbox action held for approval, recorded on its task so approving can carry
 * it out exactly as an immediate run would: a reply, a proposed time, a booking
 * confirmation, a meeting link, a Command Center share.
 */
export interface PendingInboxReply {
  threadId: string;
  action: ActionKind;
  /** The composed text, for a reply. */
  body: string | null;
  /** Who asked for it: their mailbox sends an email reply, not the approver's. */
  senderId: string;
  /** The line a Command Center share opens with. */
  sharePreface?: string | null;
  /** The work product a share carries, as it stood when it was queued. */
  backingArtifact?: BackingArtifact | null;
  /** Set once delivered; the meeting's follow-up status reads it. */
  delivered?: boolean;
  error?: string;
}

/** The pending reply on a task's result, if this task is one. */
export function extractInboxReply(result: unknown): PendingInboxReply | null {
  if (!result || typeof result !== "object") return null;
  const r = (result as { inboxReply?: unknown }).inboxReply;
  if (!r || typeof r !== "object") return null;
  const p = r as Partial<PendingInboxReply>;
  if (typeof p.threadId !== "string" || typeof p.senderId !== "string" || typeof p.action !== "string") return null;
  const artifact = p.backingArtifact;
  return {
    threadId: p.threadId,
    action: p.action as ActionKind,
    body: typeof p.body === "string" ? p.body : null,
    senderId: p.senderId,
    ...(typeof p.sharePreface === "string" ? { sharePreface: p.sharePreface } : {}),
    ...(artifact && typeof artifact === "object" && typeof artifact.verification_status === "string"
      ? { backingArtifact: { verification_status: artifact.verification_status, grounding_score: Number(artifact.grounding_score) || 0 } }
      : {}),
    delivered: p.delivered === true,
  };
}

/** "Re: <subject>", once — never "Re: Re:", never "(no subject)" when there is one. */
export function replySubject(subject: string | null | undefined): string {
  const s = (subject ?? "").trim();
  if (!s) return "(no subject)";
  return /^re\s*:/i.test(s) ? s : `Re: ${s}`;
}

const LEGACY_REPLY_PREFIX = "Unified-inbox reply on the ";
const LEGACY_ACTION_PREFIX = "Unified-inbox action on the ";

/** The action a task's title names ("Propose a time — Ana Diaz"), if it names one. */
export function actionFromTitle(title: string | null | undefined): ActionKind | null {
  const head = (title ?? "").split(" — ")[0]?.trim();
  if (!head) return null;
  for (const [action, label] of Object.entries(INBOX_ACTION_LABEL)) {
    if (label === head) return action as ActionKind;
  }
  return null;
}

/**
 * What a task queued before actions were parked on it (inboxReply) recorded of
 * its action: a reply's composed text in the description, any other action's
 * name in the title. The thread is on the task's task.created event, read by
 * the caller. Null for every other task.
 */
export function legacyActionFromTask(task: {
  title?: string | null;
  description?: string | null;
  created_by?: string | null;
}): Omit<PendingInboxReply, "threadId"> | null {
  const desc = task.description ?? "";
  if (!task.created_by) return null;
  if (desc.startsWith(LEGACY_REPLY_PREFIX)) {
    const at = desc.indexOf('":\n\n');
    if (at < 0) return null;
    const body = desc.slice(at + 4).trim();
    return body ? { action: "send_reply", body, senderId: task.created_by } : null;
  }
  if (desc.startsWith(LEGACY_ACTION_PREFIX)) {
    const named = actionFromTitle(task.title);
    // A reply needs its text, and an action without one carries none.
    if (!named || named === "send_reply") return null;
    return { action: named, body: null, senderId: task.created_by };
  }
  return null;
}

/**
 * A held (or failed) inbox message as its approval card shows it: who it goes
 * to, what it says, from which mailbox, on which conversation and meeting, and
 * what the other side last said. Built on the server (message-approvals.server)
 * so the card opens with no round trip.
 */
export interface InboxMessageApproval {
  taskId: string;
  threadId: string;
  action: ActionKind;
  /** "Reply", "Propose a time", … */
  actionLabel: string;
  /** The composed text, for a reply. */
  body: string | null;
  sharePreface: string | null;
  to: { name: string | null; email: string | null };
  /** The subject it goes out under: "Re: <thread subject>" for a reply. */
  subject: string | null;
  /** The address it will send from; null when only the org mailbox is known. */
  from: string | null;
  /** The conversation in the inbox. */
  threadHref: string;
  meeting: { id: string; title: string; roomCode: string } | null;
  contact: { company: string | null; title: string | null } | null;
  lastInbound: { body: string; at: string } | null;
  /** A reply with text: it can be edited before approving, or sent back to Earn. */
  editable: boolean;
  /** Approved but not delivered, with the reason; it can be retried. */
  failed: { error: string } | null;
}
