// lib/meetings/invite.ts
// Shared meeting-invite email logic used by the manual invite route
// (/api/meetings/invite) and the schedule/edit flows, so adding a guest email
// to a scheduled meeting actually reaches them.
import { sendEmail, escapeHtml, type SendEmailCredentials } from "@/lib/email";
import type { MeetingAttendeeInput } from "@/lib/meetings/attendees";
import { buildInviteIcs, meetingInviteUid } from "@/lib/calendar/invite";
import {
  canInviteToCalendar,
  inviteEndIso,
  scheduledRecipients,
  type ScheduledRecipient,
} from "@/lib/meetings/scheduled-invite";

export function buildMeetingInviteHtml({
  inviteUrl,
  title,
  senderName,
  whenLabel,
  role = "guest",
}: {
  inviteUrl: string;
  title: string;
  senderName: string;
  /** The meeting's time as the recipient should read it, when it has one. */
  whenLabel?: string | null;
  role?: ScheduledRecipient["role"];
}): string {
  const safeTitle = escapeHtml(title);
  const safeSender = escapeHtml(senderName);
  const safeWhen = whenLabel ? escapeHtml(whenLabel) : "";
  const safeUrl = inviteUrl.startsWith("https://") || inviteUrl.startsWith("http://") ? inviteUrl : "#";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:sans-serif;background:#0d0d10;color:#e5e5e5;padding:32px;max-width:520px;margin:0 auto">
  <div style="margin-bottom:24px">
    <span style="font-family:monospace;font-size:13px;color:#b8a36a;letter-spacing:0.1em;text-transform:uppercase">FundExecs OS</span>
  </div>
  <h1 style="font-size:20px;font-weight:600;margin:0 0 8px">${
    role === "host" ? "Your meeting is scheduled" : `${safeSender} invited you to a meeting`
  }</h1>
  <p style="color:#9ca3af;font-size:14px;margin:0 0 4px">${safeTitle}</p>
  ${safeWhen ? `<p style="color:#9ca3af;font-size:14px;margin:0 0 24px">${safeWhen}</p>` : `<div style="margin-bottom:24px"></div>`}
  <a href="${safeUrl}"
     style="display:inline-block;background:#b8a36a;color:#0d0d10;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none">
    Join meeting →
  </a>
  <p style="color:#6b7280;font-size:12px;margin:24px 0 0">
    You can join as a guest or sign up for full access with AI transcription and meeting summaries.
  </p>
</body>
</html>`;
}

/**
 * Send meeting invites to a set of email addresses. Never throws — an
 * unconnected mailbox or a per-recipient failure just lowers the `sent` count,
 * so the caller's core flow (saving the meeting) is never blocked.
 */
export async function sendMeetingInvites(args: {
  origin: string;
  roomCode: string;
  title: string;
  senderName: string;
  emails: string[];
  /** The org whose connected mailbox sends these. Without it nothing sends. */
  orgId?: string;
  /**
   * The host's own mailbox, resolved by the caller.
   *
   * An invitation is sent by a person, so it should arrive from that person's
   * address. Supplied, it takes precedence over the org mailbox; omitted, the
   * org mailbox is used as before, so a caller that has not been updated keeps
   * working rather than going silent.
   */
  credentials?: SendEmailCredentials;
  /**
   * The host. Supplied, they get a confirmation of their own and appear as the
   * ORGANIZER on the invitation — which is also what puts the meeting in their
   * calendar. Omitted, only guests hear about it, as before.
   */
  hostEmail?: string | null;
  /** Identity of the calendar entry, so a later change updates rather than doubles. */
  meetingId?: string | null;
  startIso?: string | null;
  durationMinutes?: number | null;
  /** The meeting's stored calendar_sequence, bumped by trigger on every update. */
  sequence?: number | null;
  /** The time as the recipients should read it. */
  whenLabel?: string | null;
}): Promise<{ sent: number; total: number }> {
  const guests = [...new Set(args.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const recipients = scheduledRecipients(args.hostEmail, args.senderName, guests);
  if (recipients.length === 0) return { sent: 0, total: 0 };

  const origin = (args.origin || "").replace(/\/$/, "");
  const inviteUrl = `${origin}/meeting-invite/${args.roomCode}`;

  // A real calendar invitation rather than a link somebody has to notice and
  // act on. Same iTIP builder the booking flow uses, so a meeting scheduled in
  // the app is not the poorer relation.
  const invite = buildScheduledInvite({ ...args, origin, inviteUrl, recipients });

  const results = await Promise.allSettled(
    recipients.map((r) =>
      sendEmail({
        orgId: args.orgId,
        credentials: args.credentials,
        to: { name: r.name, email: r.email },
        subject:
          r.role === "host"
            ? `Scheduled: "${args.title}"`
            : `You're invited to join "${args.title}" on FundExecs OS`,
        htmlBody: buildMeetingInviteHtml({
          inviteUrl,
          title: args.title,
          senderName: args.senderName,
          whenLabel: args.whenLabel,
          role: r.role,
        }),
        calendarInvite: invite,
      }),
    ),
  );

  const sent = results.filter((r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok).length;
  return { sent, total: recipients.length };
}

/** The .ics for a newly scheduled meeting, or undefined when it has no time. */
function buildScheduledInvite(args: {
  origin: string;
  inviteUrl: string;
  title: string;
  senderName: string;
  hostEmail?: string | null;
  meetingId?: string | null;
  startIso?: string | null;
  durationMinutes?: number | null;
  sequence?: number | null;
  recipients: ScheduledRecipient[];
}): { content: string; method: "REQUEST"; filename: string } | undefined {
  if (
    !canInviteToCalendar({
      meetingId: args.meetingId,
      startIso: args.startIso,
      hostEmail: args.hostEmail,
    })
  ) {
    return undefined;
  }

  try {
    return {
      content: buildInviteIcs({
        uid: meetingInviteUid(args.meetingId!, args.origin),
        method: "REQUEST",
        title: args.title || "Meeting",
        startIso: args.startIso!,
        endIso: inviteEndIso(args.startIso!, args.durationMinutes),
        description: `Join: ${args.inviteUrl}`,
        location: args.inviteUrl,
        url: args.inviteUrl,
        organizer: { name: args.senderName, email: args.hostEmail! },
        attendees: args.recipients.map((r) => ({ name: r.name, email: r.email })),
        sequence: Math.max(0, Math.floor(args.sequence ?? 0)),
      }),
      method: "REQUEST",
      filename: "invite.ics",
    };
  } catch (err) {
    // A malformed invitation must never stop the email that carries the actual
    // information — the recipient still needs to know the meeting exists.
    console.error("[meetings/invite] could not build calendar invite", err);
    return undefined;
  }
}

/** Pull unique, validated guest emails from an attendee list. */
export function guestEmails(attendees: MeetingAttendeeInput[] | null | undefined): string[] {
  return [
    ...new Set(
      (attendees ?? [])
        .map((a) => a.email?.trim().toLowerCase())
        .filter((e): e is string => !!e),
    ),
  ];
}
