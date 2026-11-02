// lib/lp-privacy-request.ts
// An LP asking, from their own link, for a copy of what is held about them or for
// it to be erased (SOC 2 gap G-1). Pure, so who is told and what is said are tested
// without a mailbox.
//
// The request only reaches people. Nothing is deleted or sent automatically: an
// approved or rejected LP's records may have to be kept by law, so deciding what to
// erase or hand over stays with the fund manager (the erase action in Run › Onboarding
// already refuses what must be kept). The notice carries the LP's name and what they
// asked for, never their details.
import { escapeHtml } from "@/lib/email";

export const PRIVACY_REQUEST_KINDS = ["access", "erasure"] as const;
export type PrivacyRequestKind = (typeof PRIVACY_REQUEST_KINDS)[number];

/** One request of each kind per LP per day: enough to be heard, not enough to flood a team's Inbox. */
export const PRIVACY_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function parsePrivacyKind(v: unknown): PrivacyRequestKind | null {
  return typeof v === "string" && (PRIVACY_REQUEST_KINDS as readonly string[]).includes(v) ? (v as PrivacyRequestKind) : null;
}

const ASKED: Record<PrivacyRequestKind, string> = {
  access: "asked for a copy of the information held about them",
  erasure: "asked for the information held about them to be erased",
};

/** What the LP is told after asking. Honest about who answers, and that erasure may be limited. */
export function privacyConfirmation(kind: PrivacyRequestKind, orgName: string): string {
  const org = orgName.replace(/\s+/g, " ").trim() || "your fund manager";
  return kind === "access"
    ? `Your request has been sent to ${org}. They will contact you directly with a copy of what they hold.`
    : `Your request has been sent to ${org}. They will contact you directly. Some records have to be kept by law (for example identity and sanctions checks), so they may not be able to erase everything, and they will tell you what they can.`;
}

export interface PrivacyNoticeArgs {
  orgName: string;
  lpName: string;
  kind: PrivacyRequestKind;
  reviewUrl: string;
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 120) || "An LP";
}

/** Subject and body for the team. Every LP-supplied value is escaped; a line break can't reach the subject. */
export function privacyNotice(args: PrivacyNoticeArgs): { subject: string; htmlBody: string } {
  const lp = cleanName(args.lpName);
  return {
    subject: args.kind === "access" ? `${lp} asked for a copy of their data` : `${lp} asked for their data to be erased`,
    htmlBody:
      `<p>${escapeHtml(lp)} has ${ASKED[args.kind]} held by ${escapeHtml(args.orgName)}.</p>` +
      `<p>Nothing has been changed or sent. Please contact them directly, using the details on their onboarding, within the time your privacy policy sets.</p>` +
      (args.kind === "erasure"
        ? `<p>Erasing an LP is a deliberate step in Run › Onboarding (you retype their name to confirm). It will refuse records that have to be kept.</p>`
        : "") +
      `<p><a href="${escapeHtml(args.reviewUrl)}">Open Run › Onboarding</a></p>`,
  };
}

/** The Inbox thread for the same event: plain text. */
export function privacyInboxAlert(args: { lpName: string; kind: PrivacyRequestKind }): { subject: string; preview: string; body: string } {
  const lp = cleanName(args.lpName);
  return {
    subject: args.kind === "access" ? `${lp} asked for a copy of their data` : `${lp} asked for their data to be erased`,
    preview: "Needs a reply from you. Nothing was changed.",
    body:
      `${lp} has ${ASKED[args.kind]}. Nothing has been changed or sent.\n\n` +
      `Contact them directly, using the details on their onboarding, within the time your privacy policy sets.` +
      (args.kind === "erasure" ? `\n\nErasing an LP is a deliberate step in Run › Onboarding; it refuses records that have to be kept.` : ""),
  };
}
