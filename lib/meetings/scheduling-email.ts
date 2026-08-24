// lib/meetings/scheduling-email.ts
// Notifications for the scheduling-link flow. Every state change an invitee or
// host can cause — a request, an approval, a decline, a reschedule, a
// cancellation — sends both sides the same facts: what, when (in their own
// timezone), and the one link that matters next.
//
// Like lib/meetings/invite.ts, nothing here throws: an unconfigured email
// provider must never fail a booking that was otherwise saved.
import { sendEmail, escapeHtml } from "@/lib/email";
import { formatSlotFull } from "@/lib/meetings/scheduling";

export interface BookingEmailContext {
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
  reason?: string | null;
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
 * "Add to Google Calendar" link. Kept as a link rather than an .ics attachment
 * because the shared sender (lib/email) sends HTML bodies only.
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

async function send(to: { name: string; email: string }, subject: string, htmlBody: string): Promise<boolean> {
  try {
    const result = await sendEmail({ to, subject, htmlBody });
    return result.ok;
  } catch (err) {
    console.error("[scheduling-email] send failed", err);
    return false;
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
      break;
  }

  const results = await Promise.allSettled(messages.map((m) => send(m.to, m.subject, m.html)));
  return { sent: results.filter((r) => r.status === "fulfilled" && r.value).length };
}
