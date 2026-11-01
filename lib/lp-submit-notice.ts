// lib/lp-submit-notice.ts
// What the fund manager's team is told when an LP submits their onboarding.
// Pure, so who is told and what it says are tested without a mailbox.
//
// The email says who submitted and where to review, and nothing the LP entered
// beyond their name and type: ownership, tax and ID details stay in the app,
// behind sign-in, and out of mailboxes.
import { escapeHtml } from "@/lib/email";
import { LP_TYPE_LABEL } from "@/lib/lp-wizard";
import type { LpType } from "@/lib/supabase/database.types";

/** Most people emailed for one submission; a large team is not paged for one LP. */
export const MAX_NOTICE_RECIPIENTS = 10;

/** Roles that review LPs. Viewers and ordinary members are not told. */
const REVIEWER_ROLES = new Set(["owner", "admin"]);

export interface NoticeMember {
  role: string;
  email: string | null;
  full_name: string | null;
}

export interface NoticeRecipient {
  email: string;
  name: string;
}

/**
 * Owners and admins with an email address, each once (by address, ignoring
 * case), owners first, then in a stable order, and no more than the cap.
 */
export function noticeRecipients(members: NoticeMember[]): NoticeRecipient[] {
  const seen = new Set<string>();
  const out: Array<NoticeRecipient & { rank: number }> = [];
  for (const m of members) {
    if (!REVIEWER_ROLES.has(m.role)) continue;
    const email = (m.email ?? "").trim();
    if (!email || !email.includes("@")) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ email, name: (m.full_name ?? "").trim() || email, rank: m.role === "owner" ? 0 : 1 });
  }
  return out
    .sort((a, b) => a.rank - b.rank || a.email.toLowerCase().localeCompare(b.email.toLowerCase()))
    .slice(0, MAX_NOTICE_RECIPIENTS)
    .map(({ email, name }) => ({ email, name }));
}

export interface SubmissionNoticeArgs {
  orgName: string;
  lpName: string;
  lpType: string | null;
  /** True when the LP is sending it back after the fund manager asked for changes. */
  resubmitted: boolean;
  /** Where the fund manager reviews it, in the app. */
  reviewUrl: string;
}

/** Subject and body, with every LP-supplied value escaped. A line break can't be smuggled into the subject. */
export function submissionNotice(args: SubmissionNoticeArgs): { subject: string; htmlBody: string } {
  const lpName = args.lpName.replace(/[\r\n]+/g, " ").trim() || "An LP";
  const typeLabel = args.lpType && args.lpType in LP_TYPE_LABEL ? LP_TYPE_LABEL[args.lpType as LpType] : null;
  const verb = args.resubmitted ? "sent back their onboarding with the changes you asked for" : "finished their investor onboarding";
  return {
    subject: args.resubmitted ? `${lpName} resubmitted their onboarding` : `${lpName} submitted their onboarding`,
    htmlBody:
      `<p>${escapeHtml(lpName)}${typeLabel ? ` (${escapeHtml(typeLabel)})` : ""} has ${verb} for ${escapeHtml(args.orgName)}.</p>` +
      `<p>It's waiting for your review. Nothing is approved until you do it.</p>` +
      `<p><a href="${escapeHtml(args.reviewUrl)}">Review it in Run › Onboarding</a></p>` +
      `<p>Screening results appear on the review card as they come in. You'll need to sign in to see the details.</p>`,
  };
}
