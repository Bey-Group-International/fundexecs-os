// lib/calendar/invite.ts
// The calendar invitation attached to a booking email.
//
// Distinct from lib/calendar/ics.ts's buildIcs, which publishes a subscribable
// feed. This builds a single iTIP message — METHOD:REQUEST or CANCEL, with an
// ORGANIZER and an ATTENDEE — which is what makes a mail client show
// Accept/Decline and put the meeting in someone's calendar rather than offering
// a file to download.

import { escapeText, foldLine, toIcsUtc } from "@/lib/calendar/ics";

export type InviteMethod = "REQUEST" | "CANCEL";

export interface InvitePerson {
  name?: string | null;
  email: string;
}

export interface BuildInviteOptions {
  /** Stable across every message about this booking. See `inviteUid`. */
  uid: string;
  method: InviteMethod;
  title: string;
  startIso: string;
  endIso: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  organizer: InvitePerson;
  attendees: InvitePerson[];
  /** Rises with each revision so clients accept the update. See `inviteSequence`. */
  sequence?: number;
  /** Overrides "now" for DTSTAMP — tests need it stable. */
  now?: Date;
  /**
   * A repeating series. DTSTART and DTEND are then written in the meeting's
   * own zone rather than UTC: a rule expanded from a UTC start keeps the UTC
   * hour, so a weekly 10:00 in Chicago would become 9:00 when the clocks
   * change.
   */
  recurrence?: { rrule: string; timezone: string };
  /**
   * An update to ONE meeting of a series: which instance, by the slot it was
   * first given. A client applies the message to that instance instead of
   * adding a stray event beside the series.
   */
  recurrenceId?: { timezone: string; originalStartIso: string };
}

/** "20261006T100000" — an instant as the wall clock in a zone reads it. */
export function toIcsLocal(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}${get("month")}${get("day")}T${hour}${get("minute")}${get("second")}`;
}

/** A TZID parameter value: an IANA name, nothing that could break the line. */
function tzid(timezone: string): string {
  return timezone.replace(/[^A-Za-z0-9_+\-/]/g, "");
}

/**
 * The identity of the meeting, stable for its whole life.
 *
 * A reschedule and a cancellation MUST reuse it: a client matches an update to
 * an existing entry by UID, so a fresh one on every email produces a calendar
 * full of duplicates instead of one meeting that moved.
 */
export function inviteUid(bookingId: string, origin: string): string {
  const host = hostOf(origin) || "fundexecs";
  return `booking-${bookingId}@${host}`;
}

/**
 * The identity of a meeting scheduled inside the app, as opposed to one booked
 * through a scheduling link.
 *
 * A distinct prefix from `inviteUid` so a meeting and a booking can never
 * collide on one UID — they are different rows in different tables, and a
 * collision would make one overwrite the other in somebody's calendar.
 */
export function meetingInviteUid(meetingId: string, origin: string): string {
  const host = hostOf(origin) || "fundexecs";
  return `meeting-${meetingId}@${host}`;
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host.replace(/[^A-Za-z0-9.\-:]/g, "");
  } catch {
    return "";
  }
}

/**
 * Last-resort revision number, for a caller that has no stored sequence.
 *
 * Seconds since the booking was created. Prefer the booking's own
 * `calendar_sequence`, which a trigger bumps on every update: this derivation
 * cannot tell two changes inside the same second apart, and a client ignores an
 * update whose SEQUENCE is not greater than the one it already holds — so the
 * second change of the second would never reach anyone's calendar.
 */
export function inviteSequence(createdAt: string, updatedAt?: string | null): number {
  const created = new Date(createdAt).getTime();
  const updated = new Date(updatedAt ?? createdAt).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return 0;
  return Math.max(0, Math.floor((updated - created) / 1000));
}

/** An address safe to put in a MAILTO: value — no folding, no injection. */
function mailto(email: string): string {
  return `MAILTO:${email.trim().replace(/[\r\n\s]/g, "")}`;
}

/** `CN="Ada Lovelace"` — quoted, with quotes and control characters stripped. */
function cn(name: string | null | undefined): string {
  const clean = (name ?? "").replace(/[\r\n]/g, " ").replace(/"/g, "").trim();
  return clean ? `;CN="${clean}"` : "";
}

/**
 * One iTIP message for a booking.
 *
 * CANCEL carries the same UID and a higher SEQUENCE, plus STATUS:CANCELLED —
 * that combination is what removes the entry from the invitee's calendar rather
 * than leaving a stale meeting behind.
 */
export function buildInviteIcs(opts: BuildInviteOptions): string {
  const start = new Date(opts.startIso);
  const end = new Date(opts.endIso);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error("Cannot build a calendar invite from an invalid time");
  }
  // A zero-length or inverted event is rejected outright by some clients.
  const safeEnd = end > start ? end : new Date(start.getTime() + 30 * 60_000);

  const cancelled = opts.method === "CANCEL";
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FundExecs OS//Scheduling//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${opts.method}`,
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${toIcsUtc(opts.now ?? new Date())}`,
    ...(opts.recurrence
      ? [
          `DTSTART;TZID=${tzid(opts.recurrence.timezone)}:${toIcsLocal(start, opts.recurrence.timezone)}`,
          `DTEND;TZID=${tzid(opts.recurrence.timezone)}:${toIcsLocal(safeEnd, opts.recurrence.timezone)}`,
          `RRULE:${opts.recurrence.rrule.replace(/[^A-Z0-9=;,]/g, "")}`,
        ]
      : [`DTSTART:${toIcsUtc(start)}`, `DTEND:${toIcsUtc(safeEnd)}`]),
    ...(opts.recurrenceId
      ? [
          `RECURRENCE-ID;TZID=${tzid(opts.recurrenceId.timezone)}:${toIcsLocal(
            new Date(opts.recurrenceId.originalStartIso),
            opts.recurrenceId.timezone,
          )}`,
        ]
      : []),
    `SUMMARY:${escapeText(opts.title || "Meeting")}`,
    `ORGANIZER${cn(opts.organizer.name)}:${mailto(opts.organizer.email)}`,
  ];

  for (const person of opts.attendees) {
    if (!person.email?.trim()) continue;
    lines.push(
      // RSVP=TRUE is what asks the client to show Accept/Decline. On a CANCEL
      // there is nothing to answer, so it is left off.
      `ATTENDEE${cn(person.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION${cancelled ? "" : ";RSVP=TRUE"}:${mailto(person.email)}`,
    );
  }

  if (opts.description) lines.push(`DESCRIPTION:${escapeText(opts.description)}`);
  if (opts.location) lines.push(`LOCATION:${escapeText(opts.location)}`);
  if (opts.url) lines.push(`URL:${opts.url}`);
  lines.push(`STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`);
  lines.push(`SEQUENCE:${Math.max(0, Math.trunc(opts.sequence ?? 0))}`);
  lines.push("TRANSP:OPAQUE");
  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  // CRLF is required by RFC 5545, and several clients enforce it.
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
