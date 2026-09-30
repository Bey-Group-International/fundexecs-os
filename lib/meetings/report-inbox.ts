// lib/meetings/report-inbox.ts
// What the inbox already knows about the people who were in this meeting.
//
// The report page says what happened in the room and stops there. Everything the
// same people have said in every other channel sits in the unified inbox, and
// the two never met — so the question a report leaves you with ("where are we
// with Ana?") was answered two pages away, by searching for her by hand.
//
// This is the join, and it is deliberately the same join the CRM writers already
// make: EXACT addresses, lowercased, nothing else. lib/meetings/crm-activity.ts
// and lib/inbox/crm-activity.ts both link a conversation to a person that way,
// and a third rule for the same question would be a third thing to be wrong.
// A near-match here would show one person's correspondence under another
// person's name on a page that reads as a record.
//
// Pure: no database, no clock, no network. The dates go out as ISO strings and
// are formatted in the reader's time zone by <LocalTime>, because a report of a
// meeting at 20:00 in New York is 00:00 UTC the next day.
import { boundedBody, normalizeEmail } from "@/lib/crm/contact-match";
import type { MeetingRecipient } from "@/lib/meetings/recipients";

/**
 * How many threads each attendee shows.
 *
 * A bound, not a page. Somebody the firm has been talking to for two years has
 * hundreds of threads; this panel answers "where are we with them", which the
 * most recent handful answers and three hundred rows actively obscures. The
 * total comes back alongside so the panel can say what it is not showing
 * instead of implying there is nothing more.
 */
export const THREADS_PER_ATTENDEE = 5;

/** How much of a thread's summary the panel will carry. */
export const SUMMARY_MAX = 160;

/** An inbox thread as this panel needs it. */
export interface InboxThreadRow {
  id: string;
  channel: string;
  subject: string | null;
  counterparty_email: string | null;
  status: string;
  unread: boolean;
  ai_summary: string | null;
  preview: string | null;
  last_message_at: string | null;
}

/** One thread, shaped for rendering. */
export interface ThreadDigest {
  id: string;
  channel: string;
  subject: string;
  status: string;
  unread: boolean;
  /** The model's summary when there is one, else the latest message's opening. */
  summary: string | null;
  /** ISO, or null for a thread that has no messages yet. */
  lastMessageAt: string | null;
}

/** One attendee, with what the inbox holds on them. */
export interface AttendeeHistory {
  name: string;
  email: string;
  /** Newest first, at most THREADS_PER_ATTENDEE of them. */
  threads: ThreadDigest[];
  /** How many they have in total, which may be more than `threads` holds. */
  total: number;
  /** The most recent message across ALL their threads, not just the shown ones. */
  lastContactAt: string | null;
  /** Unread threads across all of them — the one count worth surfacing. */
  unread: number;
}

export interface ReportInboxHistory {
  /** In the order the recipient set gives: invite order first, then the room. */
  attendees: AttendeeHistory[];
  /**
   * Attendees the inbox has never seen.
   *
   * Listed rather than dropped, and listed together rather than each getting an
   * empty card. "We have no correspondence with this person" is the single most
   * actionable line on a follow-up page, and eight cards saying "nothing" is the
   * reliable way to make nobody read any of them.
   */
  untouched: MeetingRecipient[];
  /**
   * True when the read this was built from hit its ceiling, so `untouched` is not
   * trustworthy and has been emptied.
   *
   * The threads come back under ONE limit shared across every attendee, so a
   * single long-standing counterparty can fill it and push another attendee's
   * threads out of the result — and that attendee then looks like somebody the
   * inbox has never seen. "No inbox history for Ana" is the most actionable line
   * on this panel, which is exactly why it must never be a guess.
   */
  capped: boolean;
}

/**
 * The counterparty address a thread belongs to, or "" when it belongs to nobody.
 *
 * A thread with a malformed or absent counterparty address matches no attendee.
 * That is the whole guard: the alternative — falling back to the subject, or to
 * a name, or to the domain — is how correspondence ends up filed under the wrong
 * person, and unlike an unmatched thread that is not recoverable by looking.
 */
export function threadCounterparty(thread: InboxThreadRow): string {
  return normalizeEmail(thread.counterparty_email);
}

/** Newest first; a thread with no messages sorts last rather than first. */
function byRecencyDesc(a: InboxThreadRow, b: InboxThreadRow): number {
  const at = a.last_message_at ?? "";
  const bt = b.last_message_at ?? "";
  if (at === bt) return a.id < b.id ? -1 : 1;
  if (!at) return 1;
  if (!bt) return -1;
  return at < bt ? 1 : -1;
}

function digest(thread: InboxThreadRow): ThreadDigest {
  // Trimmed BEFORE the fallback, not after. `ai_summary ?? preview` falls
  // through only on null, so a model that answered with a blank line — which it
  // does — suppressed a perfectly good message preview and the row said nothing
  // at all.
  const summary = (thread.ai_summary ?? "").trim() || (thread.preview ?? "").trim();
  return {
    id: thread.id,
    channel: thread.channel,
    // A thread with no subject is a real thread — Slack threads routinely have
    // none — so it is named rather than rendered as an empty row.
    subject: (thread.subject ?? "").trim() || "(no subject)",
    status: thread.status,
    unread: thread.unread === true,
    summary: summary ? boundedBody(summary, SUMMARY_MAX) : null,
    lastMessageAt: thread.last_message_at,
  };
}

/**
 * Attach each attendee to the threads that are theirs.
 *
 * Takes the recipient set the email paths already compute, so "who was in this
 * meeting" has one answer across the product: the invite list unioned with the
 * room, de-duplicated by address, with the reader left out. An attendee who
 * appears twice in the recipients — which meetingRecipients already prevents —
 * would still only be grouped once here.
 */
export function attendeeInboxHistory(input: {
  recipients: readonly MeetingRecipient[];
  threads: readonly InboxThreadRow[];
  perAttendee?: number;
}): ReportInboxHistory {
  const limit = Math.max(0, input.perAttendee ?? THREADS_PER_ATTENDEE);

  const byEmail = new Map<string, InboxThreadRow[]>();
  for (const thread of input.threads) {
    const email = threadCounterparty(thread);
    if (!email) continue;
    const bucket = byEmail.get(email);
    if (bucket) bucket.push(thread);
    else byEmail.set(email, [thread]);
  }

  const attendees: AttendeeHistory[] = [];
  const untouched: MeetingRecipient[] = [];
  const seen = new Set<string>();

  for (const recipient of input.recipients) {
    const email = normalizeEmail(recipient.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);

    const mine = byEmail.get(email);
    if (!mine || mine.length === 0) {
      untouched.push(recipient);
      continue;
    }

    const ordered = [...mine].sort(byRecencyDesc);
    attendees.push({
      name: recipient.name,
      email: recipient.email,
      threads: ordered.slice(0, limit).map(digest),
      total: ordered.length,
      // Across everything they have, not across what is shown: with the bound at
      // five, a sixth thread is still the last time this person was in touch.
      lastContactAt: ordered.find((t) => t.last_message_at)?.last_message_at ?? null,
      unread: ordered.filter((t) => t.unread === true).length,
    });
  }

  // Not capped as far as this rule knows: it is handed a list of threads and
  // cannot tell whether the read that produced it was cut short. The loader owns
  // that fact and overrides it.
  return { attendees, untouched, capped: false };
}

/**
 * The addresses a history read should ask the database for.
 *
 * Normalized here so the query and the grouping above cannot disagree about
 * what an address is — a query on the raw column values would miss
 * "Ana@Acme.com" that this module then expects to find.
 */
export function historyAddresses(recipients: readonly MeetingRecipient[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const recipient of recipients) {
    const email = normalizeEmail(recipient.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}
