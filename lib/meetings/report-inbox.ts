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
  /** The meeting the thread came out of — set on a meeting's follow-up threads. */
  meeting_id?: string | null;
  /** Newest inbound message, and when the thread was linked to its meeting. */
  last_inbound_at?: string | null;
  meeting_linked_at?: string | null;
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
  /** True for the thread this meeting's follow-up started, where its replies land. */
  fromThisMeeting: boolean;
  /** This meeting's thread, answered since it was linked. */
  replied: boolean;
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

function digest(thread: InboxThreadRow, meetingId: string | null): ThreadDigest {
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
    fromThisMeeting: Boolean(meetingId) && thread.meeting_id === meetingId,
    replied: Boolean(meetingId) && thread.meeting_id === meetingId && hasReply(thread),
  };
}

/** An inbound message after the thread was tied to its meeting. */
export function hasReply(thread: InboxThreadRow): boolean {
  if (!thread.last_inbound_at) return false;
  if (!thread.meeting_linked_at) return true;
  return Date.parse(thread.last_inbound_at) > Date.parse(thread.meeting_linked_at);
}

/** Of the attendees this meeting wrote to, how many have answered. */
export function meetingReplySummary(history: ReportInboxHistory): { written: number; replied: number } {
  let written = 0;
  let replied = 0;
  for (const a of history.attendees) {
    const own = a.threads.filter((t) => t.fromThisMeeting);
    if (own.length === 0) continue;
    written++;
    if (own.some((t) => t.replied)) replied++;
  }
  return { written, replied };
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
  /** This meeting, so its own follow-up threads are marked and shown first. */
  meetingId?: string | null;
}): ReportInboxHistory {
  const meetingId = input.meetingId ?? null;
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

    // This meeting's follow-up thread first, where the replies to it are: on a
    // report it is the conversation that matters. Recency after that.
    const ordered = [...mine].sort((a, b) => {
      const af = meetingId !== null && a.meeting_id === meetingId ? 0 : 1;
      const bf = meetingId !== null && b.meeting_id === meetingId ? 0 : 1;
      return af - bf || byRecencyDesc(a, b);
    });
    attendees.push({
      name: recipient.name,
      email: recipient.email,
      threads: ordered.slice(0, limit).map((t) => digest(t, meetingId)),
      total: ordered.length,
      // Across everything they have, not across what is shown — and the maximum,
      // not the first of `ordered`: that list puts this meeting's follow-up
      // thread first, so its date is not the newest whenever the person has a
      // more recent conversation about something else, and "last contact" on a
      // record must not understate how recently they were in touch.
      lastContactAt: mine.reduce<string | null>(
        (newest, t) =>
          t.last_message_at && (!newest || t.last_message_at > newest) ? t.last_message_at : newest,
        null,
      ),
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
