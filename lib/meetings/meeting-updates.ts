// lib/meetings/meeting-updates.ts
// Notices for a meeting that already exists. Adding a guest sends an invite
// (lib/meetings/invite.ts); moving or cancelling a meeting has to reach the
// people who were already on it — that is what this module does.
//
// Two rules shape everything here:
//
//   1. Only a real change notifies. A host fixing a typo in the agenda must not
//      mail every attendee, so callers pass timing before and after and let
//      `diffMeetingTiming` decide whether anything actually moved.
//   2. Nothing throws. The edit is already saved by the time a notice goes out;
//      an unconnected mailbox must never surface as a failed save.
import { sendEmail, type SendEmailCredentials } from "@/lib/email";
import { buildInviteIcs, meetingInviteUid } from "@/lib/calendar/invite";
import { canInviteToCalendar, inviteEndIso } from "@/lib/meetings/scheduled-invite";
import { buildSchedulingEmailHtml } from "@/lib/meetings/scheduling-email";
import { formatSlotFull } from "@/lib/meetings/scheduling";

export type MeetingUpdateKind = "rescheduled" | "relocated" | "cancelled" | "removed";

/**
 * What the calendar should be told, as opposed to what the email says.
 *
 * A reschedule REQUESTs the same UID at a new time, so the entry moves rather
 * than doubling. A relocation does the same at the SAME time — the entry has to
 * be rewritten in place or the attendee's calendar keeps pointing at the old
 * room. Cancelled and removed both CANCEL it — from the calendar's point of
 * view "the meeting is off" and "you are no longer on it" are the same
 * instruction, and leaving a stale entry behind is the worse failure either way.
 */
export function updateInviteMethod(kind: MeetingUpdateKind): "REQUEST" | "CANCEL" {
  return kind === "rescheduled" || kind === "relocated" ? "REQUEST" : "CANCEL";
}

export interface MeetingTiming {
  startIso: string | null;
  durationMinutes: number | null;
}

export interface MeetingTimingChange {
  /** True when the meeting starts at a different instant than it did. */
  startChanged: boolean;
  /** True when it still starts when it did, but runs for a different length. */
  durationChanged: boolean;
  /** Either of the above — the condition that earns an attendee an email. */
  changed: boolean;
}

/** Same point in time, however the two ISO strings happen to be spelled. */
function sameInstant(a: string | null, b: string | null): boolean {
  if (!a || !b) return a === b;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  // Unparseable input falls back to an exact string match rather than reporting
  // every save as a reschedule.
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a === b;
  return ta === tb;
}

/**
 * Compare a meeting's timing across an edit. Re-saving the same instant — a
 * different ISO spelling, or a field the host never touched — is not a change.
 */
export function diffMeetingTiming(before: MeetingTiming, after: MeetingTiming): MeetingTimingChange {
  const startChanged = !sameInstant(before.startIso, after.startIso);
  const durationChanged =
    !startChanged && (before.durationMinutes ?? null) !== (after.durationMinutes ?? null);
  return { startChanged, durationChanged, changed: startChanged || durationChanged };
}

/** Where a meeting happens: a place, and a link to join it by. */
export interface MeetingPlace {
  location: string | null;
  meetingUrl: string | null;
}

export interface MeetingPlaceChange {
  locationChanged: boolean;
  meetingUrlChanged: boolean;
  /** Either of the above — the condition that earns an attendee an email. */
  changed: boolean;
}

/** Blank, whitespace and null are the same absence of a value. */
function samePlaceField(a: string | null | undefined, b: string | null | undefined): boolean {
  return ((a ?? "").trim() || null) === ((b ?? "").trim() || null);
}

/**
 * Compare where a meeting happens across an edit.
 *
 * These two fields are singled out from everything else a host can edit because
 * they are the ones an attendee has to ACT on: a moved room or a swapped join
 * link means the calendar entry they hold now sends them to the wrong place.
 * A rewritten agenda does not — they read that when they open the meeting, and
 * mailing every wording change is how people learn to ignore these emails.
 */
export function diffMeetingPlace(before: MeetingPlace, after: MeetingPlace): MeetingPlaceChange {
  const locationChanged = !samePlaceField(before.location, after.location);
  const meetingUrlChanged = !samePlaceField(before.meetingUrl, after.meetingUrl);
  return { locationChanged, meetingUrlChanged, changed: locationChanged || meetingUrlChanged };
}

export interface MeetingUpdateContext {
  /** Canonical app origin, so the emailed link is stable across hosts/proxies. */
  origin: string;
  /** The org whose connected mailbox sends these. Without it nothing sends. */
  orgId?: string;
  roomCode: string;
  title: string;
  /** Who made the change, as attendees should see it. */
  senderName: string;
  emails: string[];
  /** The meeting's timezone — the only one the app knows for a guest list. */
  timezone: string;
  startIso?: string | null;
  /** Where the meeting used to be. Shown on a reschedule so the move is legible. */
  previousStartIso?: string | null;
  durationMinutes?: number | null;
  /** Where the meeting happens now, and where it happened before it moved. */
  location?: string | null;
  previousLocation?: string | null;
  meetingUrl?: string | null;
  previousMeetingUrl?: string | null;
  reason?: string | null;
  /**
   * The host's own mailbox, resolved by the caller. A reschedule or a
   * cancellation is sent by a person and should arrive from their address;
   * omitted, the org mailbox is used as before.
   */
  credentials?: SendEmailCredentials;
  /**
   * Identity of the calendar entry this update refers to. Without it the email
   * still goes out, it simply carries no .ics — so a caller that has not been
   * updated degrades rather than breaking.
   */
  meetingId?: string | null;
  hostEmail?: string | null;
  /** The meeting's stored calendar_sequence, which must rise on every change. */
  sequence?: number | null;
}

function whenIn(iso: string | null | undefined, timezone: string, durationMinutes?: number | null): string {
  if (!iso) return "";
  const stamp = formatSlotFull(iso, timezone || "UTC");
  return durationMinutes ? `${stamp} (${durationMinutes} min)` : stamp;
}

/**
 * The subject and body for one kind of update. Exported so the copy is testable
 * without a mail provider, and reuses the scheduling shell so every meeting
 * email in the product reads as one family.
 */
export function buildMeetingUpdateEmail(
  kind: MeetingUpdateKind,
  ctx: MeetingUpdateContext,
): { subject: string; html: string } {
  const joinUrl = `${(ctx.origin || "").replace(/\/$/, "")}/meeting-invite/${ctx.roomCode}`;
  const now = whenIn(ctx.startIso, ctx.timezone, ctx.durationMinutes);
  const previous = whenIn(ctx.previousStartIso, ctx.timezone);

  if (kind === "cancelled") {
    return {
      subject: `Cancelled: ${ctx.title}`,
      html: buildSchedulingEmailHtml({
        heading: "This meeting was cancelled",
        intro: `${ctx.senderName} cancelled this meeting. Nothing else is needed from you.`,
        rows: [
          ["Meeting", ctx.title],
          ["Was", now || previous],
          ["Reason", ctx.reason ?? ""],
        ],
        footnote: "You can delete it from your own calendar.",
      }),
    };
  }

  if (kind === "removed") {
    return {
      subject: `Removed: ${ctx.title}`,
      html: buildSchedulingEmailHtml({
        heading: "You were taken off this meeting",
        intro: `${ctx.senderName} updated the guest list. You're no longer expected to attend.`,
        rows: [
          ["Meeting", ctx.title],
          ["Was", now],
        ],
        footnote: "The meeting is still going ahead without you — you can drop it from your calendar.",
      }),
    };
  }

  if (kind === "relocated") {
    const where = (ctx.location ?? "").trim();
    const link = (ctx.meetingUrl ?? "").trim();
    const wasWhere = (ctx.previousLocation ?? "").trim();
    return {
      subject: `Updated: ${ctx.title} — new joining details`,
      html: buildSchedulingEmailHtml({
        heading: "Where this meeting happens has changed",
        intro: `${ctx.senderName} changed how to join this meeting. The time is the same — only where you go is different.`,
        rows: [
          ["Meeting", ctx.title],
          ["When", now],
          ["Where", where || link || joinUrl],
          // Naming the old place is what lets an attendee recognise that this
          // is the meeting they already hold, rather than a second one.
          ["Previously", wasWhere],
        ],
        cta: { label: "Join meeting", url: link && /^https?:\/\//i.test(link) ? link : joinUrl },
        footnote: "The time has not moved — replace the joining details on the entry you already have.",
      }),
    };
  }

  return {
    subject: `Updated: ${ctx.title} moved to a new time`,
    html: buildSchedulingEmailHtml({
      heading: "This meeting moved",
      intro: `${ctx.senderName} changed when this meeting happens. Your calendar entry is now out of date — here's the new time.`,
      rows: [
        ["Meeting", ctx.title],
        ["New time", now],
        ["Previously", previous],
      ],
      cta: { label: "Join meeting", url: joinUrl },
      footnote: "Use the same link as before — only the time changed.",
    }),
  };
}

/**
 * Mail an update to everyone already on a meeting. Never throws — a missing
 * provider or a per-recipient failure only lowers `sent`, so the edit the host
 * already made stands either way.
 */
export async function sendMeetingUpdates(
  kind: MeetingUpdateKind,
  ctx: MeetingUpdateContext,
): Promise<{ sent: number; total: number }> {
  const emails = [...new Set(ctx.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0) return { sent: 0, total: 0 };

  const { subject, html } = buildMeetingUpdateEmail(kind, ctx);

  // The same UID the invitation used, at a higher SEQUENCE. Without it a
  // reschedule leaves the old time in every calendar and adds a second entry
  // beside it, which is the failure the booking flow already learned to avoid.
  const invite = buildUpdateInvite(kind, ctx, emails);

  const results = await Promise.allSettled(
    emails.map((email) =>
      sendEmail({
        orgId: ctx.orgId,
        credentials: ctx.credentials,
        to: { name: email.split("@")[0] ?? email, email },
        subject,
        htmlBody: html,
        calendarInvite: invite,
      }),
    ),
  );

  const sent = results.filter((r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok).length;
  return { sent, total: emails.length };
}

/** The .ics for an update, or undefined when the meeting has no calendar identity. */
function buildUpdateInvite(
  kind: MeetingUpdateKind,
  ctx: MeetingUpdateContext,
  emails: string[],
): { content: string; method: "REQUEST" | "CANCEL"; filename: string } | undefined {
  const method = updateInviteMethod(kind);
  // A cancellation still needs a time: STATUS:CANCELLED on a VEVENT with no
  // DTSTART is not something a client can match to what it holds. On a
  // reschedule the new time is the whole point.
  const startIso = kind === "rescheduled" ? ctx.startIso : ctx.startIso ?? ctx.previousStartIso;
  if (
    !canInviteToCalendar({ meetingId: ctx.meetingId, startIso, hostEmail: ctx.hostEmail })
  ) {
    return undefined;
  }

  const origin = (ctx.origin || "").replace(/\/$/, "");
  const joinUrl = `${origin}/meeting-invite/${ctx.roomCode}`;
  // What the calendar entry should say about where to go. The room link is the
  // fallback, not the answer: a meeting with its own place or its own joining
  // link has to carry that, or a relocation rewrites the entry with the very
  // detail that just went stale.
  const place = (ctx.location ?? "").trim() || (ctx.meetingUrl ?? "").trim() || joinUrl;
  const description = place === joinUrl ? `Join: ${joinUrl}` : `${place}\n\nMeeting room: ${joinUrl}`;

  try {
    return {
      content: buildInviteIcs({
        uid: meetingInviteUid(ctx.meetingId!, origin),
        method,
        title: ctx.title || "Meeting",
        startIso: startIso!,
        endIso: inviteEndIso(startIso!, ctx.durationMinutes),
        description,
        location: place,
        url: joinUrl,
        organizer: { name: ctx.senderName, email: ctx.hostEmail! },
        attendees: emails.map((email) => ({ name: email.split("@")[0] ?? email, email })),
        sequence: Math.max(0, Math.floor(ctx.sequence ?? 0)),
      }),
      method,
      filename: "invite.ics",
    };
  } catch (err) {
    // The recipient still needs to know the meeting changed.
    console.error("[meetings/updates] could not build calendar invite", err);
    return undefined;
  }
}
