// lib/office/floor-invite.ts
// Server-side "join me on the Executive Floor" invite email, sent through the
// app's own mailer (Gmail API → Resend → in-app fallback) — no external client
// dependency (no mailto). The link opens the spatial office floor so the guest
// joins the operator in the in-office meeting.
import { sendEmail, escapeHtml } from "@/lib/email";

const FLOOR_PATH = "/command-center";

export function buildFloorInviteHtml({
  floorUrl,
  senderName,
}: {
  floorUrl: string;
  senderName: string;
}): string {
  const safeSender = escapeHtml(senderName);
  const safeUrl = floorUrl.startsWith("https://") || floorUrl.startsWith("http://") ? floorUrl : "#";
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:sans-serif;background:#0d0d10;color:#e5e5e5;padding:32px;max-width:520px;margin:0 auto">
  <div style="margin-bottom:24px">
    <span style="font-family:monospace;font-size:13px;color:#c9a84c;letter-spacing:0.1em;text-transform:uppercase">FundExecs OS</span>
  </div>
  <h1 style="font-size:20px;font-weight:600;margin:0 0 8px;color:#f4f0e8">${safeSender} invited you to the Executive Floor</h1>
  <p style="color:#b6bcc6;font-size:14px;margin:0 0 24px">Join the live in-office meeting on the spatial floor — walk over and you're in the video.</p>
  <a href="${safeUrl}"
     style="display:inline-block;background:#c9a84c;color:#0d0d10;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none">
    Enter the floor →
  </a>
  <p style="color:#8b93a0;font-size:12px;margin:24px 0 0">
    You can join as a guest or sign in for full access.
  </p>
</body>
</html>`;
}

/**
 * Email a floor invite to a set of addresses. Never throws — a missing provider
 * or a per-recipient failure just lowers the `sent` count.
 */
export async function sendFloorInvites(args: {
  origin: string;
  senderName: string;
  emails: string[];
}): Promise<{ sent: number; total: number }> {
  const emails = [...new Set(args.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (emails.length === 0) return { sent: 0, total: 0 };

  const origin = (args.origin || "").replace(/\/$/, "");
  const floorUrl = `${origin}${FLOOR_PATH}`;
  const html = buildFloorInviteHtml({ floorUrl, senderName: args.senderName });

  const results = await Promise.allSettled(
    emails.map((email) =>
      sendEmail({
        to: { name: email.split("@")[0] ?? email, email },
        subject: `${args.senderName} invited you to the FundExecs Executive Floor`,
        htmlBody: html,
      }),
    ),
  );

  const sent = results.filter((r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok).length;
  return { sent, total: emails.length };
}
