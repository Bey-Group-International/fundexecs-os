// lib/meetings/recipients.ts
// Who a meeting's email actually goes to.
//
// Both email paths — "Email to attendees" on the report and "Send to
// attendees" on the follow-up — addressed `live_meetings.attendees`, the list
// somebody typed before the meeting. That list is empty for every instant
// meeting: `createMeeting` writes `attendees: []` and nothing ever fills it in.
// So the product's most common kind of meeting could not email its own summary
// at all ("This meeting has no attendees with email addresses.") and could not
// send its own follow-up ("Nobody on this meeting has an email address to send
// to."), while `live_meeting_participants` held a row for every person who had
// been in the room.
//
// The invite list and the room are different sets and both matter. Somebody
// invited who never came still wants the summary of the meeting they were
// invited to; somebody who walked in uninvited was in the conversation the
// follow-up commits them to. So this unions them.
//
// The other half of the job is the people it CANNOT reach. A guest who joined
// by link has a display name and no address anywhere in this system, and the
// old code simply dropped them — then reported "Sent to 2 attendees" for a
// meeting of four, which reads as complete. Their names come back separately so
// the caller can say so, because the host is the only one who can reach them
// and they cannot do it if nobody tells them.
//
// Pure: no supabase client, no mailbox, no DOM.

/**
 * An address this will hand to a mailer.
 *
 * Checked here rather than trusted, because this is the last place between
 * stored jsonb and an outgoing message. The stored invite list was validated on
 * the way in, but "was validated once by a previous version of the write path"
 * is not the same claim as "is an address", and the cost of being wrong is a
 * send that fails for everyone after it.
 */
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Somebody the mail actually goes to. */
export interface MeetingRecipient {
  name: string;
  email: string;
}

/**
 * Somebody who was in the room.
 *
 * `email` is null for a guest who joined by link — they are an identity this
 * system knows by display name only — and for a signed-in attendee whose
 * directory row could not be read.
 */
export interface PresentPerson {
  name: string;
  email: string | null;
}

export interface RecipientSet {
  /** In invite order first, then the people who turned up uninvited. */
  recipients: MeetingRecipient[];
  /**
   * Names of people who were in the room and have no address here.
   *
   * Not an error and not a failure to send: there is nothing to send to. It is
   * reported because the host is the only person who can reach them, and the
   * count of successful sends cannot tell them apart from a meeting where
   * everybody was reached.
   */
  unreachable: string[];
}

/**
 * Everyone this meeting's email should go to.
 *
 * De-duplicated by address, case-insensitively, keeping the first appearance —
 * so the invite list's ordering (which the host typed) survives, and the room
 * only adds people the invitation missed.
 *
 * The sender is left out. The host wrote it, they are always in the room, and
 * without this every summary they send would put a copy of their own meeting in
 * their own inbox.
 */
export function meetingRecipients(input: {
  /**
   * `live_meetings.attendees`, as stored.
   *
   * Deliberately `unknown` and read defensively rather than run through
   * `normalizeAttendees` first. That function answers a different question —
   * "is this request body acceptable?" — and answers it by returning null for
   * the WHOLE array when any one entry is malformed. Used here that would mean
   * one bad row written by an older version of the schema silently costing every
   * other invited person their copy of the meeting.
   */
  invited?: unknown;
  present?: readonly PresentPerson[] | null;
  senderEmail?: string | null;
}): RecipientSet {
  const sender = (input.senderEmail ?? "").trim().toLowerCase();
  const byEmail = new Map<string, MeetingRecipient>();

  /** Add, and let a real name win over an address used as one. */
  const add = (rawName: unknown, rawEmail: unknown) => {
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    if (!email || email === sender || !EMAIL_RE.test(email)) return;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const existing = byEmail.get(email);
    if (!existing) {
      byEmail.set(email, { name: name || email, email });
      return;
    }
    // The invite list may hold an address with no name against it while the
    // directory knows the person's name, or the other way around. Either way
    // "Sarah Chen" is a better thing to put in a To: header than "s.chen".
    if (name && existing.name === email) existing.name = name;
  };

  for (const attendee of Array.isArray(input.invited) ? input.invited : []) {
    // A string entry is an address on its own: the attendee column has been
    // through several schema versions and `attendeeNames` already reads that
    // shape, so the recipient list must not be the one place that cannot.
    if (typeof attendee === "string") {
      add("", attendee);
      continue;
    }
    if (!attendee || typeof attendee !== "object") continue;
    const entry = attendee as { name?: unknown; email?: unknown };
    add(entry.name, entry.email);
  }

  const unreachable: string[] = [];
  const seenUnreachable = new Set<string>();

  for (const person of input.present ?? []) {
    if (!person || typeof person !== "object") continue;
    if (person.email) {
      add(person.name, person.email);
      continue;
    }
    const name = (person.name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seenUnreachable.has(key)) continue;
    seenUnreachable.add(key);
    unreachable.push(name);
  }

  const recipients = [...byEmail.values()];

  // Somebody already being written to is not unreachable, whatever the
  // attendance row says. A signed-in attendee whose directory row could not be
  // read still has their address on the invitation, and telling the host they
  // were missed — when the mail is on its way to them — is worse than saying
  // nothing.
  const named = new Set(recipients.map((r) => r.name.trim().toLowerCase()));
  // The sender is not "unreachable" either: they are deliberately left out.
  if (sender) named.add(sender);

  return {
    recipients,
    unreachable: unreachable.filter((name) => !named.has(name.toLowerCase())),
  };
}

/**
 * Whether the meeting can be considered followed up.
 *
 * Every person who was in it either heard from the host or is still waiting.
 * The follow-up route writes `followup_status: "done"` off this, and it used to
 * write it whenever every ADDRESS succeeded — closing out a meeting whose
 * guests were never written to at all, which hid exactly the meetings that
 * still needed a person.
 */
export function everyoneReached(set: RecipientSet, sent: number): boolean {
  return set.unreachable.length === 0 && sent === set.recipients.length && sent > 0;
}

/**
 * What a settled fan-out of sends actually achieved.
 *
 * Index-aligned with the recipients it was built from, so a failure can be
 * named rather than counted. Both routes answered `{sent, total}` and left the
 * host to work out which two of nine addresses bounced — which they cannot do,
 * and which is the only part of a partial send they can act on.
 */
export function deliveryOutcome(
  recipients: readonly MeetingRecipient[],
  results: readonly PromiseSettledResult<unknown>[],
): { sent: number; failed: string[] } {
  let sent = 0;
  const failed: string[] = [];

  recipients.forEach((recipient, i) => {
    const result = results[i];
    const ok =
      result?.status === "fulfilled" &&
      (result.value as { ok?: unknown } | null)?.ok === true;
    if (ok) sent += 1;
    else failed.push(recipient.email);
  });

  return { sent, failed };
}

/**
 * The people in the room the email could not reach, as a sentence.
 *
 * Named rather than counted up to three, because "Dana and Ravi were in the
 * room without an address" is something the host can act on and "2 people were
 * not reached" is not.
 */
export function unreachableNotice(unreachable: readonly string[]): string | null {
  if (unreachable.length === 0) return null;
  const names = unreachable.slice(0, 3).join(", ");
  const rest = unreachable.length - Math.min(3, unreachable.length);
  const who = rest > 0 ? `${names} and ${rest} ${rest === 1 ? "other" : "others"}` : names;
  const were = unreachable.length === 1 ? "was" : "were";
  return `${who} ${were} in the room without an email address here, so they were not sent to.`;
}

/**
 * The addresses a send did not reach, as a sentence.
 *
 * Named, up to three, for the same reason as the people with no address: the
 * host's next move is to try that one address again or ask somebody for a better
 * one, and a count tells them neither.
 */
export function failedNotice(failed: readonly string[]): string | null {
  if (failed.length === 0) return null;
  const names = failed.slice(0, 3).join(", ");
  const rest = failed.length - Math.min(3, failed.length);
  const who = rest > 0 ? `${names} and ${rest} ${rest === 1 ? "other" : "others"}` : names;
  return `Could not deliver to ${who}.`;
}

/**
 * What to tell the host a send actually did.
 *
 * One function for both panels, because until now each wrote its own version of
 * "Sent to N of M" against a total that counted only the addressable people —
 * so a meeting of four where two joined as guests reported "Sent to 2
 * attendees", full stop, which is a complete-sounding answer to a send that
 * reached half the room.
 *
 * Reads as one to three sentences: what went, what bounced, and who was never
 * written to at all.
 */
export function deliveryMessage(input: {
  sent: number;
  total: number;
  unreachable?: readonly string[];
  failed?: readonly string[];
  /** What to call the people, in this screen's words. */
  noun?: string;
}): string {
  const noun = input.noun ?? "attendee";
  const plural = input.total === 1 ? noun : `${noun}s`;
  const head =
    input.sent === 0
      ? "It reached nobody."
      : input.sent === input.total
        ? `Sent to ${input.total} ${plural}.`
        : `Sent to ${input.sent} of ${input.total} ${plural}.`;

  return [head, failedNotice(input.failed ?? []), unreachableNotice(input.unreachable ?? [])]
    .filter(Boolean)
    .join(" ");
}
