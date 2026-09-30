// lib/meetings/follow-up-draft.ts
// Which inbox thread a meeting's follow-up gets drafted onto.
//
// The report writes a ready-to-send follow-up, and until now the only thing the
// product could do with it was send it straight out of the report: the host's
// mailbox, everyone in the room, one press. Every other outward move in this
// product goes through the gate layer — it becomes a task and waits for a person.
// The follow-up was the exception, and it was the exception for the most
// consequential message the product sends.
//
// So it becomes a draft on each attendee's own inbox thread, sent by a person
// through the composer that already exists, and therefore through the gate that
// already governs it. This module decides which thread that is.
//
// Pure: no database, no clock, no network.
import { normalizeEmail } from "@/lib/crm/contact-match";
import type { MeetingRecipient } from "@/lib/meetings/recipients";

/**
 * The channel a follow-up draft may be placed on.
 *
 * A follow-up is an email. Drafting it onto a Slack thread, or onto a Docusign
 * notification that happens to carry the same address, would put email prose in
 * a composer that sends something else — so the thread has to be an email thread
 * or it is not a candidate, however recent it is.
 */
export const DRAFT_CHANNEL = "gmail";

/** A thread the plan may place a draft on. */
export interface DraftCandidate {
  id: string;
  channel: string;
  status: string;
  counterparty_email: string | null;
  last_message_at: string | null;
}

/** A thread to create because this attendee has none that will do. */
export interface ThreadToCreate {
  channel: string;
  category: string;
  subject: string;
  counterparty_name: string | null;
  counterparty_email: string;
}

/** One attendee's place in the plan. */
export interface DraftTarget {
  name: string;
  email: string;
  /** The existing thread to draft onto, or null when one must be created. */
  threadId: string | null;
  /** Set only when threadId is null. */
  create: ThreadToCreate | null;
}

export interface DraftPlan {
  targets: DraftTarget[];
  /**
   * People who were in the room with no address here.
   *
   * Carried through rather than dropped, for the same reason the email path
   * carries it: the host is the only one who can reach them, and a report saying
   * "drafted to 2 people" for a meeting of four reads as complete.
   */
  unreachable: string[];
}

/**
 * Whether a thread can hold a follow-up draft at all.
 *
 * `done` is excluded deliberately. Reopening somebody's closed correspondence to
 * hold a new message is worse than starting a fresh thread: the closed thread was
 * closed on purpose, and the follow-up would arrive under its old subject, in the
 * middle of a conversation that had ended.
 */
export function canHoldDraft(thread: DraftCandidate): boolean {
  return thread.channel === DRAFT_CHANNEL && thread.status !== "done";
}

/**
 * The thread this attendee's follow-up belongs on, of the ones they have.
 *
 * The most recently spoken-on eligible thread, because that is the conversation
 * the meeting was a continuation of. A tie — two threads with the same last
 * message, or two with none — breaks on the id, so the same inputs always choose
 * the same thread rather than whichever the database happened to return first.
 */
export function chooseDraftThread(candidates: readonly DraftCandidate[]): DraftCandidate | null {
  let best: DraftCandidate | null = null;
  for (const candidate of candidates) {
    if (!canHoldDraft(candidate)) continue;
    if (!best) {
      best = candidate;
      continue;
    }
    const at = candidate.last_message_at ?? "";
    const bt = best.last_message_at ?? "";
    if (at === bt) {
      if (candidate.id < best.id) best = candidate;
    } else if (!bt || (at && at > bt)) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Where each attendee's copy of the follow-up should be drafted.
 *
 * Takes the recipient set the email path already computes, so "who is this
 * follow-up for" has one answer in the product whether it is drafted or sent.
 */
export function planFollowUpDrafts(input: {
  recipients: readonly MeetingRecipient[];
  unreachable?: readonly string[];
  threads: readonly DraftCandidate[];
  /** `followUpSubject(meeting.title)` — used only for threads that must be created. */
  subject: string;
}): DraftPlan {
  const byEmail = new Map<string, DraftCandidate[]>();
  for (const thread of input.threads) {
    const email = normalizeEmail(thread.counterparty_email);
    if (!email) continue;
    const bucket = byEmail.get(email);
    if (bucket) bucket.push(thread);
    else byEmail.set(email, [thread]);
  }

  const targets: DraftTarget[] = [];
  const seen = new Set<string>();

  for (const recipient of input.recipients) {
    const email = normalizeEmail(recipient.email);
    // An attendee with no usable address gets no draft and no invented thread. A
    // thread created around a malformed address is a thread nothing can ever
    // send, sitting in the inbox looking like one that can.
    if (!email || seen.has(email)) continue;
    seen.add(email);

    const chosen = chooseDraftThread(byEmail.get(email) ?? []);
    if (chosen) {
      targets.push({ name: recipient.name, email, threadId: chosen.id, create: null });
      continue;
    }
    targets.push({
      name: recipient.name,
      email,
      threadId: null,
      create: {
        channel: DRAFT_CHANNEL,
        category: "messaging",
        subject: input.subject,
        // The address used as a name carries no information, so it is stored as
        // no name rather than as a name that is an address.
        counterparty_name: recipient.name && recipient.name !== recipient.email ? recipient.name : null,
        counterparty_email: email,
      },
    });
  }

  return { targets, unreachable: [...(input.unreachable ?? [])] };
}

/** What the report says happened, given a plan and how much of it landed. */
export function draftMessage(input: {
  drafted: number;
  created: number;
  failed: number;
  unreachable: readonly string[];
}): string {
  if (input.drafted === 0) {
    return input.failed > 0
      ? "Nothing could be drafted. Try again, or send it from here instead."
      : "There is nobody to draft this to.";
  }

  const people = input.drafted === 1 ? "1 person" : `${input.drafted} people`;
  const parts = [`Drafted in the inbox for ${people}`];
  // Said because it is the surprising half: a new thread appearing in the inbox
  // for somebody the org has never emailed is correct, and looks like a bug if
  // nobody mentions it.
  if (input.created > 0) {
    parts.push(
      input.created === 1
        ? "one of them a new thread"
        : `${input.created} of them new threads`,
    );
  }
  if (input.failed > 0) {
    parts.push(`${input.failed} could not be drafted`);
  }
  if (input.unreachable.length > 0) {
    parts.push(
      `no address here for ${input.unreachable.join(", ")}`,
    );
  }
  return `${parts.join(" · ")}. Nothing has been sent — open the inbox to send it.`;
}
