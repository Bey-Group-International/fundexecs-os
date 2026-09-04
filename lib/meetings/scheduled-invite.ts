// lib/meetings/scheduled-invite.ts
// Who hears about a meeting when it is scheduled, and what reaches their
// calendar.
//
// Scheduling a meeting used to email the guests a "Join meeting" link and
// nothing else. Two things were missing against what anyone expects from a
// scheduling tool:
//
//   The host got nothing. They had just done the scheduling, so the app treated
//   them as already informed — but the confirmation is also the thing that puts
//   the meeting in their own calendar, and a host with no guests got no email
//   at all.
//
//   Neither side got a calendar invitation. A link in an email is not an entry
//   in a calendar; somebody has to notice it and act. The booking flow already
//   sends a real iTIP REQUEST, and a meeting scheduled in the app should not be
//   the poorer relation.
//
// Pure. The send lives in invite.ts.

/** Somebody who should hear that a meeting was scheduled. */
export interface ScheduledRecipient {
  name: string;
  email: string;
  /** The host is told they scheduled it; a guest is told they are invited. */
  role: "host" | "guest";
}

/** A plausible address, lowercased. Mirrors the guest-email filter. */
function normalize(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value) ? value : null;
}

/**
 * Everyone to email, host first, deduplicated.
 *
 * The host leads because they are the one who acted, and dedup is by address
 * rather than by role: a host who put their own address in the guest list
 * should get one email describing them as the host, not two saying different
 * things about the same meeting.
 */
export function scheduledRecipients(
  hostEmail: string | null | undefined,
  hostName: string | null | undefined,
  guestEmails: readonly string[],
): ScheduledRecipient[] {
  const out: ScheduledRecipient[] = [];
  const seen = new Set<string>();

  const host = normalize(hostEmail);
  if (host) {
    seen.add(host);
    out.push({ name: hostName?.trim() || host.split("@")[0], email: host, role: "host" });
  }

  for (const raw of guestEmails) {
    const email = normalize(raw);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ name: email.split("@")[0], email, role: "guest" });
  }

  return out;
}

/**
 * Whether this meeting has enough substance to put in a calendar.
 *
 * A meeting with no time is a placeholder — an invitation for it would be an
 * entry nobody could attend. The email still goes out; it simply carries no
 * .ics, which is the same way the booking flow degrades.
 */
export function canInviteToCalendar(args: {
  meetingId: string | null | undefined;
  startIso: string | null | undefined;
  hostEmail: string | null | undefined;
}): boolean {
  if (!args.meetingId || !args.hostEmail || !args.startIso) return false;
  return !Number.isNaN(new Date(args.startIso).getTime());
}

/** When the meeting ends, for an invitation that needs both ends. */
export function inviteEndIso(startIso: string, durationMinutes: number | null | undefined): string {
  const start = new Date(startIso).getTime();
  // A meeting with no stated length is an hour, which is what the rest of the
  // app assumes; a zero-length event is rejected outright by some clients.
  const minutes = durationMinutes && durationMinutes > 0 ? durationMinutes : 60;
  return new Date(start + minutes * 60_000).toISOString();
}

/**
 * The "Save to calendar" URL for a meeting: a one-event .ics, served publicly
 * off the room code.
 *
 * Every meeting email already carries an .ics as an attachment, and for Gmail
 * and Apple Mail that is enough — they render an Accept/Decline card from it.
 * For everybody else it is a file sitting under a paperclip that has to be
 * noticed, downloaded and opened, and on a phone that is most of a minute of
 * fiddling. A link is one tap, works the same in every client, and reaches the
 * people whose mail app showed them no card at all.
 *
 * Deliberately the room code and not a new token: the code is already the
 * capability that lets an invitee open the meeting, so a link built from it
 * grants nothing they were not already holding.
 */
export function buildMeetingCalendarUrl(origin: string, roomCode: string): string {
  return `${(origin || "").replace(/\/$/, "")}/api/meetings/public/${roomCode}/calendar.ics`;
}
