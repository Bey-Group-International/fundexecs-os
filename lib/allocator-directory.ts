// lib/allocator-directory.ts
// Allocator Intelligence Directory — FinTrx clone.
// Search, filter, and score allocators against active fund thesis.

export type AllocatorType =
  | "family_office"
  | "ria"
  | "endowment"
  | "foundation"
  | "pension"
  | "sovereign"
  | "fund_of_funds"
  | "institutional"
  | "other";

export type AccreditationStatus =
  | "unknown"
  | "accredited_investor"
  | "qualified_purchaser"
  | "qualified_client"
  | "institutional"
  | "pending_verification";

export const ALLOCATOR_TYPE_LABELS: Record<AllocatorType, string> = {
  family_office: "Family Office",
  ria: "RIA",
  endowment: "Endowment",
  foundation: "Foundation",
  pension: "Pension Fund",
  sovereign: "Sovereign Fund",
  fund_of_funds: "Fund of Funds",
  institutional: "Institutional",
  other: "Other",
};

export const ACCREDITATION_LABELS: Record<AccreditationStatus, string> = {
  unknown: "Unknown",
  accredited_investor: "Accredited Investor",
  qualified_purchaser: "Qualified Purchaser",
  qualified_client: "Qualified Client",
  institutional: "Institutional",
  pending_verification: "Pending",
};

export const ACCREDITATION_COLORS: Record<AccreditationStatus, string> = {
  unknown: "text-slate-400 border-slate-500/30 bg-slate-500/10",
  accredited_investor: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  qualified_purchaser: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  qualified_client: "text-emerald-300 border-emerald-500/20 bg-emerald-500/8",
  institutional: "text-yellow-400 border-yellow-500/30 bg-yellow-500/10",
  pending_verification: "text-amber-400 border-amber-500/30 bg-amber-500/10",
};

export interface AllocatorFilter {
  search?: string;
  allocatorTypes?: AllocatorType[];
  strategies?: string[];
  geographies?: string[];
  aumMin?: number;
  aumMax?: number;
  ticketMin?: number;
  accreditation?: AccreditationStatus[];
  kycStatus?: string[];
  relationshipTier?: string[];
  minFitScore?: number;
}

// Format AUM for display
export function formatAUM(amount: number | null | undefined, _currency = "USD"): string {
  if (!amount) return "—";
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(0)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

// Format ticket size range
export function formatTicketRange(min: number | null, max: number | null): string {
  if (!min && !max) return "—";
  if (min && max) return `${formatAUM(min)} – ${formatAUM(max)}`;
  if (min) return `${formatAUM(min)}+`;
  return `Up to ${formatAUM(max)}`;
}

// Compute a fit score badge color
export function fitScoreColor(score: number): string {
  if (score >= 80) return "text-emerald-400 border-emerald-500/40 bg-emerald-500/10";
  if (score >= 60) return "text-yellow-400 border-yellow-500/40 bg-yellow-500/10";
  if (score >= 40) return "text-amber-400 border-amber-500/30 bg-amber-500/8";
  return "text-slate-400 border-slate-500/30 bg-slate-500/10";
}
