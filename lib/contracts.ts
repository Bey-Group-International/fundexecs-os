// lib/contracts.ts
// Contract Lifecycle Management logic — Contract Monkey clone.
// Handles template auto-fill, clause extraction, status tracking, renewal alerts.

export type ContractStatus =
  | "draft"
  | "review"
  | "sent"
  | "signed"
  | "active"
  | "expired"
  | "terminated";

export type DocumentType =
  | "lpa"
  | "subscription_agreement"
  | "side_letter"
  | "nda"
  | "loi"
  | "term_sheet"
  | "co_invest_agreement"
  | "advisory_agreement"
  | "other";

export interface ContractStatusMeta {
  label: string;
  color: "gold" | "blue" | "amber" | "emerald" | "red" | "slate";
  next: ContractStatus | null;
  nextLabel: string | null;
}

export const CONTRACT_STATUS_META: Record<ContractStatus, ContractStatusMeta> = {
  draft: {
    label: "Draft",
    color: "slate",
    next: "review",
    nextLabel: "Send for review",
  },
  review: {
    label: "In Review",
    color: "blue",
    next: "sent",
    nextLabel: "Send for signature",
  },
  sent: {
    label: "Sent",
    color: "amber",
    next: "signed",
    nextLabel: "Mark as signed",
  },
  signed: {
    label: "Signed",
    color: "emerald",
    next: "active",
    nextLabel: "Activate",
  },
  active: {
    label: "Active",
    color: "emerald",
    next: null,
    nextLabel: null,
  },
  expired: {
    label: "Expired",
    color: "red",
    next: null,
    nextLabel: null,
  },
  terminated: {
    label: "Terminated",
    color: "slate",
    next: null,
    nextLabel: null,
  },
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  lpa: "Limited Partnership Agreement",
  subscription_agreement: "Subscription Agreement",
  side_letter: "Side Letter",
  nda: "Non-Disclosure Agreement",
  loi: "Letter of Intent",
  term_sheet: "Term Sheet",
  co_invest_agreement: "Co-Investment Agreement",
  advisory_agreement: "Advisory Agreement",
  other: "Other",
};

/** Days until expiry (negative = already expired). Returns null if no expiry date. */
export function daysUntilExpiry(expiryDate: string | null): number | null {
  if (!expiryDate) return null;
  const ms = new Date(expiryDate).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

/** Renewal urgency classification based on days remaining. */
export function renewalUrgency(
  days: number | null,
): "expired" | "critical" | "soon" | "ok" | null {
  if (days === null) return null;
  if (days <= 0) return "expired";
  if (days <= 14) return "critical";
  if (days <= 30) return "soon";
  return "ok";
}
