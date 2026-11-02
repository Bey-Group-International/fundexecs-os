// lib/lp-subscription.ts
//
// The subscription agreement an LP signs, as one pure function so the portal
// (which shows it) and the signing action (which records it) cannot drift:
// what is stored and fingerprinted is the text the LP was shown.
import { renderDocumentTemplate } from "@/lib/document-templates";

export interface SubscriptionVars {
  fundName: string;
  orgName: string;
  jurisdiction: string;
  investorName: string;
  commitmentAmount: number | null;
}

/** "November 2, 2026": the effective date reads the same wherever it is rendered (UTC). */
export function effectiveDateLabel(now: Date = new Date()): string {
  return now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

export function subscriptionAgreementText(v: SubscriptionVars, now: Date = new Date()): string {
  return renderDocumentTemplate("subscription_agreement", {
    fundName: v.fundName,
    orgName: v.orgName,
    jurisdiction: v.jurisdiction,
    effectiveDate: effectiveDateLabel(now),
    investorName: v.investorName,
    commitmentAmount: v.commitmentAmount ? `$${Number(v.commitmentAmount).toLocaleString("en-US")}` : undefined,
  });
}
