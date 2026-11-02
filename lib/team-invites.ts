// lib/team-invites.ts
// Pure half of Team invites: the "you've been added" email and the expiry rule.
// The database half (storing, claiming, sending) is lib/team-invites.server.
import { escapeHtml } from "@/lib/email";
import { SITE_URL } from "@/lib/site";
import type { MemberRole } from "@/lib/supabase/database.types";

/** How long a pending invite stays claimable. */
export const INVITE_TTL_DAYS = 30;

/** Whether an invite can still be claimed at `now`. An unreadable date is not live. */
export function inviteIsLive(
  invite: { expires_at: string | null | undefined; accepted_at: string | null | undefined },
  now: number = Date.now(),
): boolean {
  if (invite.accepted_at) return false;
  const expires = invite.expires_at ? new Date(invite.expires_at).getTime() : NaN;
  return Number.isFinite(expires) && expires > now;
}

export interface MemberAddedEmailInput {
  orgName: string;
  /** Who added them; falls back to a generic phrase when unknown. */
  inviterName: string | null;
  /** The address the invitee must sign in with. */
  email: string;
  role: MemberRole;
  /** No account yet: the invite is waiting for them to sign in. */
  pending: boolean;
  /** A nudge to someone already told once ("Remind" on the Team page). */
  reminder?: boolean;
}

/**
 * The email that tells someone they were added to an organization.
 *
 * The button goes to the ordinary sign-in page. Nothing in the link grants
 * access: the invite is matched to the confirmed address they sign in with, so a
 * forwarded email cannot hand the seat to somebody else.
 */
export function memberAddedEmail(input: MemberAddedEmailInput): { subject: string; html: string } {
  const org = escapeHtml(input.orgName);
  const who = input.inviterName?.trim() ? escapeHtml(input.inviterName.trim()) : "A teammate";
  const email = escapeHtml(input.email);
  const elevated = input.role === "owner" || input.role === "admin";
  const roleLine = elevated
    ? `You have <strong style="color:#F5F5F5;">${input.role === "owner" ? "owner" : "admin"}</strong> access, so you can manage members and settings.`
    : `You have <strong style="color:#F5F5F5;">${escapeHtml(input.role)}</strong> access.`;
  const next = input.pending
    ? `Sign in with <strong style="color:#F5F5F5;">${email}</strong> (Google or your password) and you'll land in ${org} automatically. This invite is held for 30 days.`
    : `Sign in with <strong style="color:#F5F5F5;">${email}</strong> and ${org} will be in your workspace switcher.`;
  const url = `${SITE_URL}/login`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#111111;border:1px solid #222222;border-radius:12px;overflow:hidden;">
    <div style="padding:6px 24px;background:#F59E0B;"><span style="font-size:11px;font-weight:700;letter-spacing:0.1em;color:#0a0a0a;text-transform:uppercase;">FundExecs OS</span></div>
    <div style="padding:32px 24px;">
      <h1 style="margin:0 0 8px;font-size:22px;color:#F5F5F5;font-weight:700;">${
        input.reminder ? `Reminder: ${who} added you to ${org}` : `${who} added you to ${org}`
      }</h1>
      <p style="margin:0 0 12px;font-size:15px;color:#AAAAAA;">${roleLine}</p>
      <p style="margin:0;font-size:15px;color:#AAAAAA;">${next}</p>
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#F59E0B;color:#0a0a0a;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:700;margin-top:24px;">Sign in to join</a>
      <p style="margin:20px 0 0;font-size:12px;color:#555555;">Or copy this link: <a href="${escapeHtml(url)}" style="color:#F59E0B;">${escapeHtml(url)}</a></p>
    </div>
    <div style="padding:16px 24px;border-top:1px solid #222222;"><p style="margin:0;font-size:11px;color:#555555;">You received this because someone added ${email} to ${org} on FundExecs OS. If this was unexpected, you can ignore it.</p></div>
  </div>
</body>
</html>`;

  const subject = input.reminder
    ? `Reminder: join ${input.orgName} on FundExecs OS`
    : `${input.inviterName?.trim() || "A teammate"} added you to ${input.orgName} on FundExecs OS`;
  return { subject, html };
}
