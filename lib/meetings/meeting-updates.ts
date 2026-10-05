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
import { buildMeetingCalendarUrl, canInviteToCalendar, inviteEndIso, meetingPlace } from "@/lib/meetings/scheduled-invite";
import { meetingInviteUrl, meetingJoinUrl } from "@/lib/meetings/share";
import { buildSchedulingEmailHtml } from "@/lib/meetings/scheduling-email";
import { formatSlotFull } from "@/lib/meetings/scheduling";
import { buildSeriesInviteUrl } from "@/lib/meetings/invite";

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
  /**
   * The meeting is one of a repeating series. Guests hold the series, not this
   * meeting, so the update names the series and which instance it changes.
   */
  series?: { seriesId: string; originalStartIso: string } | null;
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
  const joinUrl = meetingInviteUrl(ctx.origin, ctx.roomCode);
  // Where the button goes: the meeting's own conferencing link when it has
  // one, else the room. One rule for every notice, so a guest who gets a
  // reschedule and then a reminder is not sent to two different rooms.
  const pressUrl = meetingJoinUrl(ctx.origin, ctx.roomCode, ctx.meetingUrl);
  const now = whenIn(ctx.startIso, ctx.timezone, ctx.durationMinutes);
  const previous = whenIn(ctx.previousStartIso, ctx.timezone);
  // A one-tap correction for the entry the recipient already holds. Offered on
  // the two updates that leave a meeting in the calendar; a cancellation and a
  // removal are told by their .ics to take it out, and a "save" button beside
  // that would be asking for the opposite of what the email says.
  const calendarUrl =
    ctx.startIso ? { label: "Save the new time to your calendar", url: buildMeetingCalendarUrl(ctx.origin, ctx.roomCode) } : null;

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
        cta: { label: "Join meeting", url: pressUrl },
        secondary: calendarUrl ? { ...calendarUrl, label: "Save the new details to your calendar" } : null,
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
      cta: { label: "Join meeting", url: pressUrl },
      secondary: calendarUrl,
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

  const origin = (ctx.origin || "").trim().replace(/\/+$/, "");
  const joinUrl = meetingInviteUrl(origin, ctx.roomCode);
  // What the calendar entry should say about where to go — the same rule the
  // invitation applied, so this rewrites the entry rather than contradicting it.
  const { place, description } = meetingPlace({ location: ctx.location, meetingUrl: ctx.meetingUrl, joinUrl });

  try {
    return {
      content: buildInviteIcs({
        uid: meetingInviteUid(ctx.series?.seriesId ?? ctx.meetingId!, origin),
        method,
        recurrenceId: ctx.series
          ? { timezone: ctx.timezone || "UTC", originalStartIso: ctx.series.originalStartIso }
          : undefined,
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

/**
 * The series context for an update about one meeting, from its stored row, or
 * null for a meeting that does not repeat.
 */
export function seriesUpdateContext(
  row: { series_id?: unknown; series_original_start?: unknown } | null | undefined,
): { seriesId: string; originalStartIso: string } | null {
  const seriesId = typeof row?.series_id === "string" ? row.series_id : null;
  const originalStartIso = typeof row?.series_original_start === "string" ? row.series_original_start : null;
  return seriesId && originalStartIso ? { seriesId, originalStartIso } : null;
}

export interface SeriesEndContext {
  origin: string;
  orgId?: string;
  credentials?: SendEmailCredentials;
  title: string;
  senderName: string;
  emails: string[];
  /** The series' own zone, which its invitation was written in. */
  timezone: string;
  /** The series, as its invitation named it: the first meeting's id. */
  seriesId: string;
  hostEmail?: string | null;
  /** Must exceed the sequence guests hold for the series. */
  sequence: number;
  /** Where the series began (its first slot) and how long each meeting runs. */
  firstStartIso: string;
  durationMinutes?: number | null;
  /**
   * The rule for the meetings that stay, or null when none do and the whole
   * series is off.
   */
  keepRrule: string | null;
  /** The first meeting that no longer happens. */
  fromStartIso: string;
  /** How many meetings were cancelled. */
  cancelled: number;
  reason?: string | null;
  /**
   * Why the series stops where it does, for the email's wording; the calendar
   * instruction is the same either way.
   *  - "ended" (default): the meetings from here on are cancelled.
   *  - "changed": they continue under a new invitation, with new details.
   *  - "removed": they continue without this guest.
   */
  variant?: "ended" | "changed" | "removed";
}

/**
 * The email for a series cut short. Exported so the copy is testable without
 * a mail provider.
 */
export function buildSeriesEndEmail(ctx: SeriesEndContext): { subject: string; html: string } {
  const from = whenIn(ctx.fromStartIso, ctx.timezone);
  const count = `${ctx.cancelled} meeting${ctx.cancelled === 1 ? "" : "s"}`;
  if (ctx.variant === "removed") {
    return {
      subject: `Removed: ${ctx.title}`,
      html: buildSchedulingEmailHtml({
        heading: ctx.keepRrule ? "You were taken off the rest of this series" : "You were taken off this repeating meeting",
        intro: ctx.keepRrule
          ? `${ctx.senderName} updated the guest list from ${from} onward. You're no longer expected at those meetings; the ones before then are unchanged.`
          : `${ctx.senderName} updated the guest list. You're no longer expected at these meetings.`,
        rows: [["Meeting", ctx.title]],
        footnote: "The meetings are still going ahead without you.",
      }),
    };
  }
  if (ctx.variant === "changed") {
    return {
      subject: `Updated: ${ctx.title} changes from ${from}`,
      html: buildSchedulingEmailHtml({
        heading: "This repeating meeting changes",
        intro: `${ctx.senderName} changed this meeting from ${from} onward. The meetings before then are unchanged, and a new invitation covers the rest.`,
        rows: [["Meeting", ctx.title]],
        footnote: "Your calendar entry for the series now ends before the change; accept the new invitation for the meetings after it.",
      }),
    };
  }
  if (!ctx.keepRrule) {
    return {
      subject: `Cancelled: ${ctx.title} (all meetings)`,
      html: buildSchedulingEmailHtml({
        heading: "This repeating meeting was cancelled",
        intro: `${ctx.senderName} cancelled every remaining meeting in this series. Nothing else is needed from you.`,
        rows: [
          ["Meeting", ctx.title],
          ["Cancelled", `${count}, from ${from}`],
          ["Reason", ctx.reason ?? ""],
        ],
        footnote: "You can delete the series from your own calendar.",
      }),
    };
  }
  return {
    subject: `Updated: ${ctx.title} ends early`,
    html: buildSchedulingEmailHtml({
      heading: "This repeating meeting ends early",
      intro: `${ctx.senderName} cancelled this meeting from ${from} onward. The meetings before then are unchanged.`,
      rows: [
        ["Meeting", ctx.title],
        ["Cancelled", `${count}, from ${from}`],
        ["Reason", ctx.reason ?? ""],
      ],
      cta: { label: "Open the series", url: buildSeriesInviteUrl(ctx.origin, ctx.seriesId) },
      footnote: "Your calendar entry for the series updates to the new last meeting.",
    }),
  };
}

/**
 * Tell a series' guests that it stops early, or stops altogether.
 *
 * Guests hold the series as one repeating entry, so cancelling its tail meeting
 * by meeting would mean one email per week. Instead the series itself is
 * revised: the same UID, REQUESTed again with a shorter COUNT, which every
 * calendar reads as "the series now ends sooner". When nothing is left it is
 * CANCELled as a whole. Never throws, like every other notice here.
 */
export async function sendSeriesEnded(ctx: SeriesEndContext): Promise<{ sent: number; total: number }> {
  const emails = [...new Set(ctx.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0) return { sent: 0, total: 0 };
  const { subject, html } = buildSeriesEndEmail(ctx);

  const origin = (ctx.origin || "").replace(/\/$/, "");
  const seriesUrl = buildSeriesInviteUrl(origin, ctx.seriesId);
  let invite: { content: string; method: "REQUEST" | "CANCEL"; filename: string } | undefined;
  if (canInviteToCalendar({ meetingId: ctx.seriesId, startIso: ctx.firstStartIso, hostEmail: ctx.hostEmail })) {
    const method = ctx.keepRrule ? "REQUEST" : "CANCEL";
    try {
      invite = {
        content: buildInviteIcs({
          uid: meetingInviteUid(ctx.seriesId, origin),
          method,
          // The series begins where it always did; only its end moves. A CANCEL
          // names the series by UID alone, with no instance, so all of it goes.
          recurrence: ctx.keepRrule ? { rrule: ctx.keepRrule, timezone: ctx.timezone || "UTC" } : undefined,
          title: ctx.title || "Meeting",
          startIso: ctx.firstStartIso,
          endIso: inviteEndIso(ctx.firstStartIso, ctx.durationMinutes),
          description: `Join: ${seriesUrl}`,
          location: seriesUrl,
          url: seriesUrl,
          organizer: { name: ctx.senderName, email: ctx.hostEmail! },
          attendees: emails.map((email) => ({ name: email.split("@")[0] ?? email, email })),
          sequence: Math.max(0, Math.floor(ctx.sequence)),
        }),
        method,
        filename: "invite.ics",
      };
    } catch (err) {
      console.error("[meetings/updates] could not build series invite", err);
    }
  }

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
