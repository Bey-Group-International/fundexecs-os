// lib/lp-reminders.ts
// When an LP who has not finished their setup is reminded. Pure, so the timing
// and the wording are tested without a clock or a mailbox.
//
// A link lasts 7 days. An LP who has not submitted is reminded on day 3 and day 6.
// An LP the fund manager is waiting on (submitted) or has decided is never
// reminded, and neither is one whose link has run out.
import { escapeHtml } from "@/lib/email";
import { LINK_TTL_DAYS } from "@/lib/lp-wizard";

export const REMINDER_DAYS = [3, 6] as const;
export type ReminderDay = (typeof REMINDER_DAYS)[number];

const DAY_MS = 86_400_000;

export interface ReminderCandidate {
  review_state: string;
  status: string;
  created_at: string;
  expires_at: string;
  reminded_day3_at: string | null;
  reminded_day6_at: string | null;
}

/**
 * Which reminder is due now, if any. If the sweep was down and both are overdue,
 * only the later one is due: the LP gets one email, not two.
 */
export function dueReminder(s: ReminderCandidate, now: number): ReminderDay | null {
  if (s.review_state !== "not_started" && s.review_state !== "in_progress") return null;
  if (s.status === "expired") return null;
  if (new Date(s.expires_at).getTime() <= now) return null;

  const age = now - new Date(s.created_at).getTime();
  if (age >= 6 * DAY_MS) return s.reminded_day6_at ? null : 6;
  if (age >= 3 * DAY_MS) return s.reminded_day3_at ? null : 3;
  return null;
}

export function reminderEmail(args: {
  day: ReminderDay;
  lpName: string;
  orgName: string;
  url: string;
  expiresAt: string;
}): { subject: string; htmlBody: string } {
  const expires = new Date(args.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const lead =
    args.day === 6
      ? `Your onboarding link with ${escapeHtml(args.orgName)} expires soon, on ${escapeHtml(expires)}.`
      : `${escapeHtml(args.orgName)} is waiting for you to finish your investor onboarding.`;
  return {
    subject: args.day === 6 ? `${args.orgName}: your onboarding link expires soon` : `${args.orgName}: finish your investor onboarding`,
    htmlBody:
      `<p>Hello ${escapeHtml(args.lpName)},</p>` +
      `<p>${lead}</p>` +
      `<p><a href="${escapeHtml(args.url)}">Continue your onboarding</a></p>` +
      `<p>You'll be asked for a code we email you when you open the link. The link works until ${escapeHtml(expires)} (${LINK_TTL_DAYS} days from when it was sent).</p>` +
      `<p>If you've already finished, you can ignore this email.</p>`,
  };
}
