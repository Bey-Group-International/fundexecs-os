// lib/meetings/scheduling-email.ts
// Notifications for the scheduling-link flow. Every state change an invitee or
// host can cause — a request, an approval, a decline, a reschedule, a
// cancellation — sends both sides the same facts: what, when (in their own
// timezone), and the one link that matters next.
//
// Like lib/meetings/invite.ts, nothing here throws: an unconnected mailbox must
// never fail a booking that was otherwise saved.
import { sendEmail, escapeHtml, type SendEmailCredentials } from "@/lib/email";
import { formatSlotFull } from "@/lib/meetings/scheduling";
import { buildInviteIcs, inviteSequence, inviteUid } from "@/lib/calendar/invite";

export interface BookingEmailContext {
  /**
   * The org whose connected mailbox sends these. The public booking flow has no
   * signed-in user, so it comes from the scheduling page's organization.
   */
  orgId?: string;
  eventTitle: string;
  hostName: string;
  hostEmail?: string | null;
  inviteeName: string;
  inviteeEmail: string;
  inviteeTimezone: string;
  hostTimezone: string;
  startIso: string;
  endIso: string;
  durationMinutes: number;
  notes?: string | null;
  /** Room link — present once the booking is confirmed. */
  joinUrl?: string | null;
  /** The invitee's cancel/reschedule link. */
  manageUrl?: string | null;
  /** The host's meetings page. */
  hostMeetingsUrl?: string | null;
  /** Where the booking used to sit — shown on a reschedule so the move reads clearly. */
  previousStartIso?: string | null;
  reason?: string | null;
  /**
   * Identity for the calendar invitation. Without these the emails still send,
   * they simply carry no .ics — so an older caller degrades rather than breaks.
   */
  bookingId?: string | null;
  bookingCreatedAt?: string | null;
  bookingUpdatedAt?: string | null;
  /**
   * The booking's stored `calendar_sequence`, bumped by a trigger on every
   * update. Always pass it: the timestamp fallback below cannot separate two
   * changes made inside the same second, and the second one would be ignored.
   */
  bookingSequence?: number | null;
  /** Origin the UID is namespaced to, so two deployments never collide. */
  siteUrl?: string | null;
  /**
   * The host's own mailbox, resolved by the caller.
   *
   * Booking email has no logged-in sender — an anonymous visitor triggers it —
   * so the person it should come from is the host whose link was used. Omitted,
   * the org mailbox is used as before.
   */
  credentials?: SendEmailCredentials;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Google Calendar's "add event" datetime format: YYYYMMDDTHHmmssZ. */
function toGCalDate(d: Date): string {
  return (
    d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    "T" +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    "00Z"
  );
}

/**
 * "Add to Google Calendar" link, used by the booking emails.
 *
 * A link rather than a reference to the attached .ics because these predate
 * both the multipart sender and the per-meeting .ics endpoint. Meeting emails
 * use buildMeetingCalendarUrl instead, which works in every calendar rather
 * than only Google; these could follow once a booking carries its room code
 * this far.
 */
export function googleCalendarLink(ctx: {
  title: string;
  startIso: string;
  endIso: string;
  details?: string | null;
}): string {
  const start = new Date(ctx.startIso);
  const end = new Date(ctx.endIso);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return "";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ctx.title,
    dates: `${toGCalDate(start)}/${toGCalDate(end)}`,
  });
  if (ctx.details) params.set("details", ctx.details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith("https://") || url.startsWith("http://") ? url : null;
}

interface TemplateInput {
  heading: string;
  intro: string;
  rows: Array<[string, string]>;
  cta?: { label: string; url: string } | null;
  secondary?: { label: string; url: string } | null;
  footnote?: string | null;
}

/** Shared shell so every scheduling email reads as one family. */
export function buildSchedulingEmailHtml(input: TemplateInput): string {
  const rows = input.rows
    .filter(([, value]) => Boolean(value))
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:6px 16px 6px 0;color:#6b7280;font-size:13px;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td>
        <td style="padding:6px 0;color:#e5e5e5;font-size:13px">${escapeHtml(value)}</td>
      </tr>`,
    )
    .join("");

  const cta = safeUrl(input.cta?.url)
    ? `<a href="${safeUrl(input.cta!.url)}" style="display:inline-block;background:#b8a36a;color:#0d0d10;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none">${escapeHtml(
        input.cta!.label,
      )} →</a>`
    : "";

  const secondary = safeUrl(input.secondary?.url)
    ? `<p style="margin:16px 0 0"><a href="${safeUrl(input.secondary!.url)}" style="color:#b8a36a;font-size:13px;text-decoration:none">${escapeHtml(
        input.secondary!.label,
      )}</a></p>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:sans-serif;background:#0d0d10;color:#e5e5e5;padding:32px;max-width:520px;margin:0 auto">
  <div style="margin-bottom:24px">
    <span style="font-family:monospace;font-size:13px;color:#b8a36a;letter-spacing:0.1em;text-transform:uppercase">FundExecs OS</span>
  </div>
  <h1 style="font-size:20px;font-weight:600;margin:0 0 8px">${escapeHtml(input.heading)}</h1>
  <p style="color:#9ca3af;font-size:14px;margin:0 0 20px">${escapeHtml(input.intro)}</p>
  <table style="border-collapse:collapse;margin:0 0 24px">${rows}</table>
  ${cta}
  ${secondary}
  ${
    input.footnote
      ? `<p style="color:#6b7280;font-size:12px;margin:24px 0 0">${escapeHtml(input.footnote)}</p>`
      : ""
  }
</body>
</html>`;
}

async function send(
  to: { name: string; email: string },
  subject: string,
  htmlBody: string,
  orgId?: string,
  calendarInvite?: { content: string; method: "REQUEST" | "CANCEL"; filename?: string },
  credentials?: SendEmailCredentials,
): Promise<boolean> {
  try {
    const result = await sendEmail({ orgId, to, subject, htmlBody, calendarInvite, credentials });
    return result.ok;
  } catch (err) {
    console.error("[scheduling-email] send failed", err);
    return false;
  }
}

/**
 * Which iTIP message, if any, belongs on this email.
 *
 * A request that has not been accepted yet is not a meeting, so no invite goes
 * out until it is confirmed — putting a tentative hold in someone's calendar
 * that the host then declines is worse than sending nothing. A decline or a
 * cancellation carries CANCEL so the entry is removed rather than left behind.
 */
export function inviteMethodFor(kind: BookingEmailKind): "REQUEST" | "CANCEL" | null {
  switch (kind) {
    case "confirmed":
    case "rescheduled":
    case "rescheduled_by_host":
      return "REQUEST";
    case "declined":
    case "cancelled_by_invitee":
    case "cancelled_by_host":
      return "CANCEL";
    case "requested":
      return null;
  }
}

/** The .ics for this transition, or null when there is nothing to send. */
function inviteFor(kind: BookingEmailKind, ctx: BookingEmailContext) {
  const method = inviteMethodFor(kind);
  if (!method || !ctx.bookingId || !ctx.hostEmail) return undefined;

  try {
    const content = buildInviteIcs({
      uid: inviteUid(ctx.bookingId, ctx.siteUrl ?? ""),
      method,
      title: `${ctx.eventTitle} with ${ctx.hostName}`,
      startIso: ctx.startIso,
      endIso: ctx.endIso,
      description: ctx.joinUrl ? `Join: ${ctx.joinUrl}` : ctx.notes ?? null,
      location: ctx.joinUrl ?? null,
      url: ctx.joinUrl ?? null,
      organizer: { name: ctx.hostName, email: ctx.hostEmail },
      attendees: [
        { name: ctx.inviteeName, email: ctx.inviteeEmail },
        { name: ctx.hostName, email: ctx.hostEmail },
      ],
      sequence:
        typeof ctx.bookingSequence === "number" && Number.isFinite(ctx.bookingSequence)
          ? Math.max(0, Math.floor(ctx.bookingSequence))
          : inviteSequence(ctx.bookingCreatedAt ?? new Date(0).toISOString(), ctx.bookingUpdatedAt),
    });
    return { content, method, filename: "invite.ics" };
  } catch (err) {
    // A malformed invite must never stop the email that carries the actual
    // information — the recipient still needs to know the meeting changed.
    console.error("[scheduling-email] could not build calendar invite", err);
    return undefined;
  }
}

function whenFor(ctx: BookingEmailContext, timezone: string): string {
  return `${formatSlotFull(ctx.startIso, timezone)} (${ctx.durationMinutes} min)`;
}

export type BookingEmailKind =
  | "requested"
  | "confirmed"
  | "declined"
  | "rescheduled"
  | "rescheduled_by_host"
  | "cancelled_by_invitee"
  | "cancelled_by_host";

/**
 * Notify both sides about a booking transition. Returns how many messages
 * actually went out, so callers can surface "we couldn't email them" without
 * failing the booking itself.
 */
export async function sendBookingEmails(
  kind: BookingEmailKind,
  ctx: BookingEmailContext,
): Promise<{ sent: number }> {
  const gcal = googleCalendarLink({
    title: ctx.eventTitle,
    startIso: ctx.startIso,
    endIso: ctx.endIso,
    details: ctx.joinUrl ? `Join: ${ctx.joinUrl}` : null,
  });

  const inviteeWhen = whenFor(ctx, ctx.inviteeTimezone);
  const hostWhen = whenFor(ctx, ctx.hostTimezone);
  const inviteePrevious = ctx.previousStartIso
    ? formatSlotFull(ctx.previousStartIso, ctx.inviteeTimezone)
    : "";
  const hostPrevious = ctx.previousStartIso
    ? formatSlotFull(ctx.previousStartIso, ctx.hostTimezone)
    : "";
  const messages: Array<{ to: { name: string; email: string }; subject: string; html: string }> = [];

  const inviteeTo = { name: ctx.inviteeName, email: ctx.inviteeEmail };
  const hostTo = ctx.hostEmail ? { name: ctx.hostName, email: ctx.hostEmail } : null;

  switch (kind) {
    case "requested":
      messages.push({
        to: inviteeTo,
        subject: `Request sent: ${ctx.eventTitle} with ${ctx.hostName}`,
        html: buildSchedulingEmailHtml({
          heading: "Your booking request was sent",
          intro: `${ctx.hostName} will confirm or decline your requested time. You'll get an email either way.`,
          rows: [
            ["Meeting", ctx.eventTitle],
            ["Requested", inviteeWhen],
            ["With", ctx.hostName],
            ["Your note", ctx.notes ?? ""],
          ],
          cta: ctx.manageUrl ? { label: "View or cancel your request", url: ctx.manageUrl } : null,
          footnote: "This time is held for you until it's confirmed or declined.",
        }),
      });
      if (hostTo) {
        messages.push({
          to: hostTo,
          subject: `New booking request: ${ctx.inviteeName} — ${ctx.eventTitle}`,
          html: buildSchedulingEmailHtml({
            heading: "Someone requested a meeting",
            intro: `${ctx.inviteeName} booked a time through your scheduling link and is waiting on your approval.`,
            rows: [
              ["Meeting", ctx.eventTitle],
              ["Requested", hostWhen],
              ["From", `${ctx.inviteeName} (${ctx.inviteeEmail})`],
              ["Their note", ctx.notes ?? ""],
            ],
            cta: ctx.hostMeetingsUrl ? { label: "Approve or decline", url: ctx.hostMeetingsUrl } : null,
            footnote: "The slot stays blocked on your calendar until you decide.",
          }),
        });
      }
      break;

    case "confirmed":
      messages.push({
        to: inviteeTo,
        subject: `Confirmed: ${ctx.eventTitle} with ${ctx.hostName}`,
        html: buildSchedulingEmailHtml({
          heading: "Your meeting is confirmed",
          intro: `You're all set with ${ctx.hostName}. Use the link below when it's time.`,
          rows: [
            ["Meeting", ctx.eventTitle],
            ["When", inviteeWhen],
            ["With", ctx.hostName],
          ],
          cta: ctx.joinUrl ? { label: "Join meeting", url: ctx.joinUrl } : null,
          secondary: gcal ? { label: "Add to Google Calendar", url: gcal } : null,
          footnote: ctx.manageUrl ? `Need to change it? ${ctx.manageUrl}` : null,
        }),
      });
      if (hostTo) {
        messages.push({
          to: hostTo,
          subject: `Booked: ${ctx.inviteeName} — ${ctx.eventTitle}`,
          html: buildSchedulingEmailHtml({
            heading: "A meeting was booked on your calendar",
            intro: `${ctx.inviteeName} booked time through your scheduling link. It's on your FundExecs calendar.`,
            rows: [
              ["Meeting", ctx.eventTitle],
              ["When", hostWhen],
              ["With", `${ctx.inviteeName} (${ctx.inviteeEmail})`],
              ["Their note", ctx.notes ?? ""],
            ],
            cta: ctx.joinUrl ? { label: "Open meeting room", url: ctx.joinUrl } : null,
            secondary: gcal ? { label: "Add to Google Calendar", url: gcal } : null,
          }),
        });
      }
      break;

    case "declined":
      messages.push({
        to: inviteeTo,
        subject: `Declined: ${ctx.eventTitle} with ${ctx.hostName}`,
        html: buildSchedulingEmailHtml({
          heading: "Your request wasn't confirmed",
          intro: `${ctx.hostName} couldn't take the time you requested. You're welcome to pick another.`,
          rows: [
            ["Meeting", ctx.eventTitle],
            ["Requested", inviteeWhen],
            ["Reason", ctx.reason ?? ""],
          ],
          cta: ctx.manageUrl ? { label: "Pick another time", url: ctx.manageUrl } : null,
        }),
      });
      break;

    case "rescheduled":
      messages.push({
        to: inviteeTo,
        subject: `Rescheduled: ${ctx.eventTitle} with ${ctx.hostName}`,
        html: buildSchedulingEmailHtml({
          heading: "Your meeting moved",
          intro: "Here's the new time. The old one has been released.",
          rows: [
            ["Meeting", ctx.eventTitle],
            ["New time", inviteeWhen],
            ["With", ctx.hostName],
          ],
          cta: ctx.joinUrl ? { label: "Join meeting", url: ctx.joinUrl } : null,
          secondary: gcal ? { label: "Add to Google Calendar", url: gcal } : null,
          footnote: ctx.manageUrl ? `Manage this booking: ${ctx.manageUrl}` : null,
        }),
      });
      if (hostTo) {
        messages.push({
          to: hostTo,
          subject: `Rescheduled: ${ctx.inviteeName} — ${ctx.eventTitle}`,
          html: buildSchedulingEmailHtml({
            heading: "An invitee moved their meeting",
            intro: `${ctx.inviteeName} picked a new time from your available slots.`,
            rows: [
              ["Meeting", ctx.eventTitle],
              ["New time", hostWhen],
              ["With", `${ctx.inviteeName} (${ctx.inviteeEmail})`],
            ],
            cta: ctx.joinUrl ? { label: "Open meeting room", url: ctx.joinUrl } : null,
          }),
        });
      }
      break;

    // The host moved the booking from their own calendar. The invitee did not
    // choose this time, so the notice leads with the change and keeps their
    // manage link prominent — accepting the move is not automatic consent.
    case "rescheduled_by_host":
      messages.push({
        to: inviteeTo,
        subject: `Moved: ${ctx.eventTitle} with ${ctx.hostName}`,
        html: buildSchedulingEmailHtml({
          heading: "Your meeting moved to a new time",
          intro: `${ctx.hostName} changed when this meeting happens. Your calendar entry is now out of date.`,
          rows: [
            ["Meeting", ctx.eventTitle],
            ["New time", inviteeWhen],
            ["Previously", inviteePrevious],
            ["With", ctx.hostName],
          ],
          cta: ctx.joinUrl ? { label: "Join meeting", url: ctx.joinUrl } : null,
          secondary: gcal ? { label: "Add to Google Calendar", url: gcal } : null,
          footnote: ctx.manageUrl
            ? `If the new time doesn't work, cancel or pick another: ${ctx.manageUrl}`
            : null,
        }),
      });
      // The host holds a calendar entry of their own — they were an ATTENDEE on
      // the original REQUEST. Only mailing the invitee leaves the host's own
      // calendar showing the old time, which is how a host misses a meeting
      // they themselves moved.
      if (hostTo) {
        messages.push({
          to: hostTo,
          subject: `Moved: ${ctx.inviteeName} — ${ctx.eventTitle}`,
          html: buildSchedulingEmailHtml({
            heading: "You moved this meeting",
            intro: `${ctx.inviteeName} has been told. Your calendar entry is updated to the new time.`,
            rows: [
              ["Meeting", ctx.eventTitle],
              ["New time", hostWhen],
              ["Previously", hostPrevious],
              ["With", `${ctx.inviteeName} (${ctx.inviteeEmail})`],
            ],
            cta: ctx.joinUrl ? { label: "Open meeting room", url: ctx.joinUrl } : null,
          }),
        });
      }
      break;

    case "cancelled_by_invitee":
      if (hostTo) {
        messages.push({
          to: hostTo,
          subject: `Cancelled: ${ctx.inviteeName} — ${ctx.eventTitle}`,
          html: buildSchedulingEmailHtml({
            heading: "An invitee cancelled",
            intro: `${ctx.inviteeName} cancelled their booking. The slot is open again.`,
            rows: [
              ["Meeting", ctx.eventTitle],
              ["Was", hostWhen],
              ["With", `${ctx.inviteeName} (${ctx.inviteeEmail})`],
              ["Reason", ctx.reason ?? ""],
            ],
          }),
        });
      }
      messages.push({
        to: inviteeTo,
        subject: `Cancelled: ${ctx.eventTitle} with ${ctx.hostName}`,
        html: buildSchedulingEmailHtml({
          heading: "Your booking is cancelled",
          intro: "We've let the host know. Nothing else is needed from you.",
          rows: [
            ["Meeting", ctx.eventTitle],
            ["Was", inviteeWhen],
          ],
        }),
      });
      break;

    case "cancelled_by_host":
      messages.push({
        to: inviteeTo,
        subject: `Cancelled: ${ctx.eventTitle} with ${ctx.hostName}`,
        html: buildSchedulingEmailHtml({
          heading: "Your meeting was cancelled",
          intro: `${ctx.hostName} cancelled this booking. You can pick another time whenever suits you.`,
          rows: [
            ["Meeting", ctx.eventTitle],
            ["Was", inviteeWhen],
            ["Reason", ctx.reason ?? ""],
          ],
          cta: ctx.manageUrl ? { label: "Pick another time", url: ctx.manageUrl } : null,
        }),
      });
      // Without this the CANCEL never reaches the host's own calendar and the
      // meeting they cancelled stays on it, blocking the slot they just freed.
      if (hostTo) {
        messages.push({
          to: hostTo,
          subject: `Cancelled: ${ctx.inviteeName} — ${ctx.eventTitle}`,
          html: buildSchedulingEmailHtml({
            heading: "You cancelled this meeting",
            intro: `${ctx.inviteeName} has been told and the slot is open again.`,
            rows: [
              ["Meeting", ctx.eventTitle],
              ["Was", hostWhen],
              ["With", `${ctx.inviteeName} (${ctx.inviteeEmail})`],
              ["Reason", ctx.reason ?? ""],
            ],
          }),
        });
      }
      break;
  }

  // The same invitation goes to both sides: the host's own calendar entry has
  // to move when a booking is rescheduled, not only the invitee's.
  const invite = inviteFor(kind, ctx);
  const results = await Promise.allSettled(
    messages.map((m) => send(m.to, m.subject, m.html, ctx.orgId, invite, ctx.credentials)),
  );
  return { sent: results.filter((r) => r.status === "fulfilled" && r.value).length };
}
