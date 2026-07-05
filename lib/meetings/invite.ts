// lib/meetings/invite.ts
// Shared meeting-invite email logic used by the manual invite route
// (/api/meetings/invite) and the schedule/edit flows, so adding a guest email
// to a scheduled meeting actually reaches them.
import { sendEmail, escapeHtml } from "@/lib/email";
import type { MeetingAttendeeInput } from "@/lib/meetings/attendees";

export function buildMeetingInviteHtml({
  inviteUrl,
  title,
  senderName,
}: {
  inviteUrl: string;
  title: string;
  senderName: string;
}): string {
  const safeTitle = escapeHtml(title);
  const safeSender = escapeHtml(senderName);
  const safeUrl = inviteUrl.startsWith("https://") || inviteUrl.startsWith("http://") ? inviteUrl : "#";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:sans-serif;background:#0d0d10;color:#e5e5e5;padding:32px;max-width:520px;margin:0 auto">
  <div style="margin-bottom:24px">
    <span style="font-family:monospace;font-size:13px;color:#b8a36a;letter-spacing:0.1em;text-transform:uppercase">FundExecs OS</span>
  </div>
  <h1 style="font-size:20px;font-weight:600;margin:0 0 8px">${safeSender} invited you to a meeting</h1>
  <p style="color:#9ca3af;font-size:14px;margin:0 0 24px">${safeTitle}</p>
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
 * Send meeting invites to a set of email addresses. Never throws — a missing
 * email provider or a per-recipient failure just lowers the `sent` count, so
 * the caller's core flow (saving the meeting) is never blocked.
 */
export async function sendMeetingInvites(args: {
  origin: string;
  roomCode: string;
  title: string;
  senderName: string;
  emails: string[];
}): Promise<{ sent: number; total: number }> {
  const emails = [...new Set(args.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0) return { sent: 0, total: 0 };

  const origin = (args.origin || "").replace(/\/$/, "");
  const inviteUrl = `${origin}/meeting-invite/${args.roomCode}`;
  const html = buildMeetingInviteHtml({ inviteUrl, title: args.title, senderName: args.senderName });

  const results = await Promise.allSettled(
    emails.map((email) =>
      sendEmail({
        to: { name: email.split("@")[0] ?? email, email },
        subject: `You're invited to join "${args.title}" on FundExecs OS`,
        htmlBody: html,
      }),
    ),
  );

  const sent = results.filter((r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok).length;
  return { sent, total: emails.length };
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
