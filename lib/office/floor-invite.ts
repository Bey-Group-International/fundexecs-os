// lib/office/floor-invite.ts
// Server-side "join me on the Executive Floor" invite email, sent through the
// app's own mailer (Gmail API → Resend → in-app fallback) — no external client
// dependency (no mailto). The link opens the spatial office floor so the guest
// joins the operator in the in-office meeting.
import { sendEmail, escapeHtml } from "@/lib/email";
import { officeInviteUrl } from "@/lib/office/floor-link";
import { createInviteToken } from "@/lib/office/invite-tokens";

export function buildFloorInviteHtml({
  floorUrl,
  senderName,
  meet = false,
}: {
  floorUrl: string;
  senderName: string;
  /** Meeting invite copy (drops the guest straight into the live video) vs a room invite. */
  meet?: boolean;
}): string {
  const safeSender = escapeHtml(senderName);
  const safeUrl = floorUrl.startsWith("https://") || floorUrl.startsWith("http://") ? floorUrl : "#";
  const heading = meet
    ? `${safeSender} invited you to a video meeting`
    : `${safeSender} invited you to the Executive Floor`;
  const blurb = meet
    ? "This link drops you straight into the live meeting on the spatial floor — camera and mic ready."
    : "Join the Executive Floor — you'll land right in the room, walk over, and you're in.";
  const cta = meet ? "Join the meeting →" : "Enter the floor →";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:sans-serif;background:#0d0d10;color:#e5e5e5;padding:32px;max-width:520px;margin:0 auto">
  <div style="margin-bottom:24px">
    <span style="font-family:monospace;font-size:13px;color:#c9a84c;letter-spacing:0.1em;text-transform:uppercase">FundExecs OS</span>
  </div>
  <h1 style="font-size:20px;font-weight:600;margin:0 0 8px;color:#f4f0e8">${heading}</h1>
  <p style="color:#b6bcc6;font-size:14px;margin:0 0 24px">${blurb}</p>
  <a href="${safeUrl}"
     style="display:inline-block;background:#c9a84c;color:#0d0d10;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none">
    ${cta}
  </a>
  <p style="color:#8b93a0;font-size:12px;margin:24px 0 0">
    You can join as a guest or sign in for full access.
  </p>
</body>
</html>`;
}

/**
 * Email a floor invite to a set of addresses. The link targets a specific room
 * (so guests land where the sender is) and, for a meeting invite, carries
 * `meet=1` so the office auto-opens the video dock on arrival. Never throws — a
 * missing provider or a per-recipient failure just lowers the `sent` count.
 */
export async function sendFloorInvites(args: {
  origin: string;
  senderName: string;
  emails: string[];
  /** Room key to drop the invitee into (omit for the default floor entry). */
  room?: string | null;
  /** When true, send a video-meeting invite (auto-opens the dock on arrival). */
  meet?: boolean;
  /** Marketplace listing id this invite convenes a deal room around. */
  deal?: string | null;
  /** Principal id of the sender — recorded on each minted invite token. */
  inviterId?: string | null;
  /** Sender's email — recorded on each minted invite token. */
  inviterEmail?: string | null;
  /** Sender's org — recorded on each minted invite token. */
  organizationId?: string | null;
}): Promise<{ sent: number; total: number }> {
  const emails = [...new Set(args.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0) return { sent: 0, total: 0 };

  const subject = args.meet
    ? `${args.senderName} invited you to a video meeting on FundExecs`
    : `${args.senderName} invited you to the FundExecs Executive Floor`;

  const results = await Promise.allSettled(
    emails.map(async (email) => {
      // Mint a single-use token per recipient so each link is unique and can't be
      // forwarded, reused, or replayed. When the token backend is unavailable
      // (createInviteToken → null), fall back to the shared link (no `invite`
      // param) so the invite still sends and works exactly as it did before.
      const token = await createInviteToken({
        email,
        room: args.room,
        meet: args.meet,
        deal: args.deal,
        inviterId: args.inviterId,
        inviterEmail: args.inviterEmail,
        organizationId: args.organizationId,
      });
      const floorUrl = officeInviteUrl(args.origin, {
        room: args.room,
        meet: args.meet,
        deal: args.deal,
        invite: token ?? undefined,
      });
      const html = buildFloorInviteHtml({ floorUrl, senderName: args.senderName, meet: args.meet });
      return sendEmail({
        to: { name: email.split("@")[0] ?? email, email },
        subject,
        htmlBody: html,
      });
    }),
  );

  const sent = results.filter((r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok).length;
  return { sent, total: emails.length };
}
