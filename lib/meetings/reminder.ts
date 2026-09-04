// lib/meetings/reminder.ts
// The manual "Send reminder" nudge: who receives it, when it may be sent, and
// what it says.
//
// `reminder_minutes` on a meeting was stored for a long time and never acted
// on — nothing in the codebase sent a reminder. Two things send one now: the
// host-triggered button (/api/meetings/[id]/remind), and the hourly sweep,
// whose due-rules live at the bottom of this file.
//
// Pure: no email, no Supabase. The rules about refusing to send live here so
// the awkward ones — a meeting that already happened, a guest list of nothing
// but blanks, a second click thirty seconds after the first — are testable.

import { escapeHtml } from "@/lib/email";

/**
 * How long before the same meeting can be reminded again.
 *
 * These land in other people's inboxes, several of them external. A host who
 * clicks twice means "did that work?", not "send it again".
 */
export const REMINDER_COOLDOWN_MS = 10 * 60_000;

/** Past this point a reminder is a curiosity rather than a prompt. */
export const REMINDER_MAX_LEAD_MS = 14 * 24 * 3600_000;

export interface ReminderRecipient {
  name: string;
  email: string;
}

/**
 * An attendee as this module needs to see one.
 *
 * Deliberately looser than MeetingAttendeeInput: attendee rows are written by
 * several paths, including a public booking page, and this code's whole job is
 * to cope with a name or an address being absent. A type that insisted both
 * were present would be describing data that does not always arrive.
 */
export interface ReminderAttendee {
  name?: string | null;
  email?: string | null;
  type?: string | null;
}

export interface RemindableMeeting {
  title: string | null;
  status: string | null;
  scheduled_at: string | null;
  is_draft: boolean | null;
  deleted_at?: string | null;
  attendees: ReminderAttendee[] | null;
  last_reminder_sent_at?: string | null;
}

/** A plausible address, lowercased. Mirrors the guest-email filter. */
function normalizeEmail(raw: string | undefined | null): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return null;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value)) return null;
  return value;
}

/**
 * Who gets the reminder, deduplicated.
 *
 * Falls back to the address for a display name: "ada" reads better than an
 * empty greeting, and an attendee with no name is normal.
 */
export function reminderRecipients(attendees: ReminderAttendee[] | null | undefined): ReminderRecipient[] {
  const seen = new Set<string>();
  const out: ReminderRecipient[] = [];

  for (const a of attendees ?? []) {
    const email = normalizeEmail(a?.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ name: a?.name?.trim() || email.split("@")[0], email });
  }

  return out;
}

export interface ReminderVerdict {
  ok: boolean;
  /** Why not, phrased for the host rather than the log. */
  reason?: string;
  recipients: ReminderRecipient[];
}

/**
 * Whether this meeting can be reminded about right now.
 *
 * Ordered so the most useful refusal wins: a host looking at a meeting with no
 * guests should be told that, not that it is a draft.
 */
export function canSendReminder(meeting: RemindableMeeting, now: Date = new Date()): ReminderVerdict {
  const recipients = reminderRecipients(meeting.attendees);

  // Deletion comes first because it is the only check about whether the meeting
  // exists at all; telling someone their deleted meeting has no guest addresses
  // would answer a question they did not ask.
  if (meeting.deleted_at) return { ok: false, reason: "That meeting was deleted.", recipients };

  // Everything below is about whether a send makes sense, and among those an
  // empty guest list is the most useful thing to say: it is the one the host
  // can act on now, and it does not stop being true once the meeting is saved
  // or the date comes closer. Ordering it after "more than two weeks away"
  // would send a host off to wait a week only to find there was nobody to
  // remind all along.
  if (recipients.length === 0) {
    return { ok: false, reason: "Nobody on this meeting has an email address.", recipients };
  }

  if (meeting.is_draft) return { ok: false, reason: "Save the meeting before reminding anyone.", recipients };
  if (meeting.status === "ended") return { ok: false, reason: "That meeting has already ended.", recipients };
  // 'active' means somebody opened the room. That can happen before
  // scheduled_at — a host who starts early — so the clock check below would
  // miss it and remind people about a meeting they are already able to join.
  if (meeting.status === "active") {
    return { ok: false, reason: "That meeting has already started.", recipients };
  }
  if (!meeting.scheduled_at) return { ok: false, reason: "That meeting has no scheduled time.", recipients };

  const start = new Date(meeting.scheduled_at);
  if (Number.isNaN(start.getTime())) {
    return { ok: false, reason: "That meeting has no scheduled time.", recipients };
  }
  if (start.getTime() <= now.getTime()) {
    return { ok: false, reason: "That meeting has already started.", recipients };
  }
  if (start.getTime() - now.getTime() > REMINDER_MAX_LEAD_MS) {
    return { ok: false, reason: "That meeting is more than two weeks away.", recipients };
  }

  const wait = reminderCooldownRemaining(meeting.last_reminder_sent_at, now);
  if (wait > 0) {
    return { ok: false, reason: `A reminder just went out. Try again in ${describeDuration(wait)}.`, recipients };
  }

  return { ok: true, recipients };
}

/** Milliseconds left on the cooldown, or 0 when a reminder may be sent. */
export function reminderCooldownRemaining(
  lastSentAt: string | null | undefined,
  now: Date = new Date(),
  cooldownMs: number = REMINDER_COOLDOWN_MS,
): number {
  if (!lastSentAt) return 0;
  const last = new Date(lastSentAt).getTime();
  // An unparseable or future timestamp must not lock the button forever.
  if (!Number.isFinite(last) || last > now.getTime()) return 0;
  return Math.max(0, cooldownMs - (now.getTime() - last));
}

/** "9 minutes", "1 minute", "30 seconds", "1 second" — for a wait, not a date. */
export function describeDuration(ms: number): string {
  if (ms < 60_000) {
    const seconds = Math.max(1, Math.ceil(ms / 1000));
    return seconds === 1 ? "1 second" : `${seconds} seconds`;
  }
  const minutes = Math.ceil(ms / 60_000);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/**
 * How far off the meeting is, in the words a reminder would use.
 *
 * Deliberately coarse: "in about 2 hours" is what someone acts on, where
 * "in 1h 57m" invites them to check the arithmetic.
 */
export function describeTimeUntil(startIso: string, now: Date = new Date()): string {
  const start = new Date(startIso).getTime();
  if (!Number.isFinite(start)) return "soon";
  const ms = start - now.getTime();
  if (ms <= 0) return "now";

  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return minutes <= 1 ? "in a minute" : `in ${minutes} minutes`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "in about an hour" : `in about ${hours} hours`;

  const days = Math.round(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

export interface ReminderEmailInput {
  title: string;
  hostName: string;
  whenLabel: string;
  timeUntil: string;
  joinUrl?: string | null;
  /** A one-tap "Save to calendar" .ics, for a recipient who never saved it. */
  calendarUrl?: string | null;
  note?: string | null;
}

/** Subject and body for one reminder. */
export function buildReminderEmail(input: ReminderEmailInput): { subject: string; html: string } {
  const title = input.title?.trim() || "your meeting";
  const safeTitle = escapeHtml(title);
  const safeHost = escapeHtml(input.hostName?.trim() || "Your host");
  const safeWhen = escapeHtml(input.whenLabel);
  const safeUntil = escapeHtml(input.timeUntil);
  const safeNote = input.note?.trim() ? escapeHtml(input.note.trim()) : "";
  // Two separate hazards. The scheme test keeps javascript: out of an href; the
  // escaping keeps a quote in the rest of the URL from closing the attribute and
  // opening another one. A scheme check alone would let
  // `https://x.test/" onmouseover="…` through as markup.
  const url =
    input.joinUrl && /^https?:\/\//i.test(input.joinUrl) ? escapeHtml(input.joinUrl) : null;
  // A reminder is the last chance to notice the meeting is not in your
  // calendar, which is often exactly why a reminder is the first anyone hears
  // of it. Same two hazards as the join link, handled the same way.
  const calendar =
    input.calendarUrl && /^https?:\/\//i.test(input.calendarUrl) ? escapeHtml(input.calendarUrl) : null;

  return {
    subject: `Reminder: ${title} — ${input.timeUntil}`,
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:sans-serif;background:#0d0d10;color:#e5e5e5;padding:32px;max-width:520px;margin:0 auto">
  <div style="margin-bottom:24px">
    <span style="font-family:monospace;font-size:13px;color:#b8a36a;letter-spacing:0.1em;text-transform:uppercase">FundExecs OS</span>
  </div>
  <h1 style="font-size:20px;font-weight:600;margin:0 0 8px">${safeTitle} is ${safeUntil}</h1>
  <p style="color:#9ca3af;font-size:14px;margin:0 0 4px">${safeWhen}</p>
  <p style="color:#6b7280;font-size:13px;margin:0 0 24px">A reminder from ${safeHost}.</p>
  ${safeNote ? `<p style="color:#9ca3af;font-size:14px;margin:0 0 24px">${safeNote}</p>` : ""}
  ${
    url
      ? `<a href="${url}"
     style="display:inline-block;background:#b8a36a;color:#0d0d10;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none">
    Join meeting →
  </a>`
      : ""
  }
  ${
    calendar
      ? `<p style="margin:16px 0 0"><a href="${calendar}" style="color:#b8a36a;font-size:13px;text-decoration:none">Save to calendar</a></p>`
      : ""
  }
</body>
</html>`,
  };
}

// ---------------------------------------------------------------------------
// The scheduled sweep
//
// `reminder_minutes` is a promise the app makes on the schedule screen, and
// until now only Google ever kept it — a meeting that was never synced got no
// reminder at all, and the manual button only fires when a host remembers to
// press it. These are the rules the hourly sweep runs on.
// ---------------------------------------------------------------------------

/**
 * How far ahead of a reminder's nominal time the sweep may fire it.
 *
 * The sweep runs hourly, so a "15 minutes before" reminder has no exact moment
 * to be sent at: by the time the next sweep comes round the meeting has usually
 * already started. Firing up to one sweep early is the resolution of that — a
 * reminder that arrives within the hour before the meeting is useful, and one
 * that arrives after it began is not a reminder at all.
 *
 * Tighten this the day the sweep runs more often; the rule below reads it
 * rather than assuming an hour.
 */
export const REMINDER_SWEEP_LOOKAHEAD_MS = 60 * 60_000;

/** A meeting as the sweep sees one, with what it needs to decide and to send. */
export interface SweepableMeeting extends RemindableMeeting {
  id: string;
  organization_id?: string | null;
  host_id?: string | null;
  reminder_minutes: number | null;
  room_code?: string | null;
  meeting_url?: string | null;
  timezone?: string | null;
  duration_minutes?: number | null;
}

/**
 * Whether the sweep should remind about this meeting now.
 *
 * Every refusal `canSendReminder` makes still applies — a draft, a deleted
 * meeting, a guest list with no addresses, a meeting already started, the
 * cooldown after a manual send. On top of those the sweep asks two more
 * questions: did the host actually ask for a reminder, and has its moment
 * arrived.
 */
export function isReminderDue(
  meeting: SweepableMeeting,
  now: Date = new Date(),
  lookaheadMs: number = REMINDER_SWEEP_LOOKAHEAD_MS,
): boolean {
  // No reminder configured is not a reminder at zero minutes — it is the host
  // choosing "No reminder", which the schedule screen offers explicitly.
  const minutes = meeting.reminder_minutes;
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) return false;

  // A reminder already sent for this meeting is not sent again. The cooldown
  // inside canSendReminder is measured in minutes and exists to absorb a double
  // click; across a whole meeting the sweep needs "once", so it checks the
  // stamp outright.
  if (meeting.last_reminder_sent_at) return false;

  if (!canSendReminder(meeting, now).ok) return false;

  const start = new Date(meeting.scheduled_at!).getTime();
  return start - now.getTime() <= minutes * 60_000 + lookaheadMs;
}

/** The meetings this sweep should remind about, soonest first. */
export function dueReminders(
  meetings: readonly SweepableMeeting[] | null | undefined,
  now: Date = new Date(),
  lookaheadMs: number = REMINDER_SWEEP_LOOKAHEAD_MS,
): SweepableMeeting[] {
  return (meetings ?? [])
    .filter((m) => isReminderDue(m, now, lookaheadMs))
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());
}
