// lib/inbox/crm-activity.ts
// What a conversation in the inbox writes onto the CRM record of the person on
// the other end of it.
//
// The second half of the same idea as lib/meetings/crm-activity.ts, and
// deliberately the same rules: EXACT addresses only, is_system on every row,
// one row per thread rather than per message. A contact's record should read as
// "we have been talking since March", not as four hundred separate events.
//
// One row per THREAD is the whole shape of this. A thread grows — forty replies
// over two months are one relationship, and writing one activity per message
// would bury every hand-logged note under a wall of email. So the row is
// upserted on the thread and kept current: its subject, its latest summary, and
// the instant of the most recent message.
//
// Pure: no database, no clock, no network.

import { boundedBody, contactForEmail, type EmailIndex } from "@/lib/crm/contact-match";
import { IDENTITY_ASSERTED } from "@/lib/crm/identity-assurance";

/** The inbox channels a thread can arrive on. */
export type InboxChannelKey =
  | "gmail"
  | "slack"
  | "calendly"
  | "google_calendar"
  | "zoom"
  | "google_meet"
  | "docusign";

/**
 * `network_activities.activity_type` for each channel.
 *
 * Mapped rather than guessed: the column has a CHECK constraint, so an
 * unrecognised channel must land on a type the database actually accepts.
 * Everything that is not mail or chat is "other" — a Zoom notification is a
 * record of contact, but calling it a "meeting" would put it alongside the
 * entries the meetings writer makes for meetings that genuinely happened, and
 * those two must not be confused on a record people read.
 */
const TYPE_FOR_CHANNEL: Record<InboxChannelKey, "email" | "linkedin" | "other"> = {
  gmail: "email",
  slack: "other",
  calendly: "other",
  google_calendar: "other",
  zoom: "other",
  google_meet: "other",
  docusign: "other",
};

export function activityTypeForChannel(channel: string): "email" | "linkedin" | "other" {
  return TYPE_FOR_CHANNEL[channel as InboxChannelKey] ?? "other";
}

export interface InboxThreadForCrm {
  id: string;
  channel: string;
  subject: string | null;
  counterpartyEmail: string | null;
  /** The model's summary of the thread, when there is one. */
  aiSummary: string | null;
  /** The first two hundred characters of the latest message. */
  preview: string | null;
  /** When the most recent message arrived. */
  lastMessageAt: string | null;
}

export interface InboxCrmInput {
  thread: InboxThreadForCrm;
  contactsByEmail: EmailIndex;
  /** Used only when the thread carries no message time of its own. */
  now: string;
}

/** One row, shaped for `network_activities`. */
export interface InboxCrmActivity {
  contactId: string;
  activityType: "email" | "linkedin" | "other";
  direction: "inbound";
  subject: string;
  body: string;
  occurredAt: string;
  isSystem: true;
  metadata: {
    thread_id: string;
    channel: string;
    source: "inbox_thread";
    /**
     * The link to this contact rests on an address the sender supplied.
     *
     * Every inbox channel asserts rather than proves: an email's From header is
     * written by whoever sent it, and a booking form's address is typed by
     * whoever filled it in. The webhook signature authenticates the PROVIDER,
     * not the identity the message claims. Marked on the row so the record can
     * say what it actually knows — see lib/crm/identity-assurance.ts.
     */
    identity: typeof IDENTITY_ASSERTED;
  };
}

/** How much of a conversation reaches the record. */
export const INBOX_BODY_MAX = 1000;

/** Said when a thread has neither a summary nor a preview to show. */
export const NO_PREVIEW_BODY = "No preview was available for this conversation.";

/**
 * The activity row for this thread, or null when there is nobody to write it
 * against.
 *
 * Null is the common case and not a failure: most of an inbox is people who are
 * not in the CRM. Returning null rather than a partial row keeps the decision in
 * one place — the caller writes what it is given and nothing else.
 */
export function threadActivity(input: InboxCrmInput): InboxCrmActivity | null {
  const { thread } = input;
  const contactId = contactForEmail(input.contactsByEmail, thread.counterpartyEmail);
  if (!contactId) return null;

  // The summary if the model wrote one, else the latest message's preview. Both
  // can be absent — a thread can be ingested before either exists.
  const summary = (thread.aiSummary ?? "").trim();
  const preview = (thread.preview ?? "").trim();
  const text = summary || preview;

  return {
    contactId,
    activityType: activityTypeForChannel(thread.channel),
    // The inbox is what reaches the organisation. Per-message direction lives on
    // inbox_messages and is deliberately not read here: one row describes a whole
    // thread, and a thread with replies in both directions has no single one.
    direction: "inbound",
    subject: (thread.subject ?? "").trim() || "Conversation",
    body: text ? boundedBody(text, INBOX_BODY_MAX) : NO_PREVIEW_BODY,
    // When the conversation last moved, not when this row was written. A thread
    // ingested today whose last message was in March belongs in March.
    occurredAt: thread.lastMessageAt ?? input.now,
    isSystem: true,
    metadata: {
      thread_id: thread.id,
      channel: thread.channel,
      source: "inbox_thread",
      identity: IDENTITY_ASSERTED,
    },
  };
}
