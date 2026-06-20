// lib/deal-share.ts
// Sharing a deal across the ecosystem — the pure core. Given a deal and a pool
// of investor profiles, it ranks the AngelList-style structured fit (check size
// · stage · sector · geography) by reusing the same lib/matching engine the
// marketplace already trusts, and it builds the confidential teaser memo + the
// professional alert copy that travel to matched orgs. No DB, no I/O, no server-
// only imports — so every piece unit-tests with small in-memory fixtures. The
// orchestration (memo via Claude, cross-org reads, alert fan-out, token mint)
// lives in lib/deal-share.server.ts.
import type { Deal, DealStage, Investor, MarketplaceListing } from "@/lib/supabase/database.types";
import {
  rankInvestorsForListing,
  type InvestorMatch,
  type ListingContext,
} from "@/lib/matching";

// --- Display helpers --------------------------------------------------------

const STAGE_LABEL: Record<DealStage, string> = {
  sourced: "sourced",
  screening: "screening",
  diligence: "in diligence",
  underwriting: "underwriting",
  ic_review: "at IC review",
  closing: "closing",
  owned: "owned",
  exited: "exited",
  passed: "passed",
  dead: "dead",
};

export function stageLabel(stage: DealStage): string {
  return STAGE_LABEL[stage] ?? stage;
}

export function sectorLabel(assetClass: string | null): string {
  if (!assetClass) return "private markets";
  return assetClass.replace(/_/g, " ");
}

// Compact USD, e.g. $4.2M / $750K. Used in the teaser, never exact to the dollar.
export function fmtUsd(amount: number | null): string | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(amount / 1_000)}K`;
  return `$${Math.round(amount)}`;
}

// --- Matching ---------------------------------------------------------------

/**
 * Adapt a deal into the listing shape lib/matching scores against. A shared deal
 * is a `deal`-type listing carrying the deal's target allocation; geography and
 * sector ride in the ListingContext. This lets a deal reuse the exact check-size
 * / geography / investor-type affinity bands the marketplace already uses.
 */
export function dealToListing(deal: Deal): MarketplaceListing {
  return {
    id: `deal-share:${deal.id}`,
    organization_id: deal.organization_id,
    title: deal.name,
    listing_type: "deal",
    summary: null,
    deal_id: deal.id,
    fund_id: deal.fund_id,
    amount: deal.target_amount,
    status: "listed",
    is_public: true,
    metadata: {},
    created_at: deal.created_at,
    updated_at: deal.updated_at,
  };
}

export interface DealMatchOpts {
  minScore?: number;
  limit?: number;
}

/**
 * Rank investor profiles by structured fit to a deal, strongest first. Reuses
 * lib/matching with the deal's geography + sector as context. `minScore` drops
 * weak fits (default 50 — a notch above the marketplace floor, since these push
 * an alert); `limit` caps the surfaced set.
 */
export function rankInvestorMatchesForDeal(
  deal: Deal,
  investors: Investor[],
  opts: DealMatchOpts = {},
): InvestorMatch[] {
  const { minScore = 50, limit = 8 } = opts;
  const listing = dealToListing(deal);
  const ctx: ListingContext = { geography: deal.geography, assetClass: deal.asset_class };
  return rankInvestorsForListing(listing, investors, { ctx, minScore, limit });
}

// --- Teaser, memo, and alert copy -------------------------------------------

export interface DealTeaser {
  name: string;
  stage: string;
  sector: string;
  geography: string | null;
  amount: string | null;
}

/** The confidential, public-safe facets of a deal — never its notes or source. */
export function dealTeaser(deal: Deal): DealTeaser {
  return {
    name: deal.name,
    stage: stageLabel(deal.stage),
    sector: sectorLabel(deal.asset_class),
    geography: deal.geography,
    amount: fmtUsd(deal.target_amount),
  };
}

/**
 * Deterministic teaser memo — the offline fallback when no model is configured,
 * and the template Earn's drafted version refines. One tight institutional
 * paragraph: what the deal is, never anything confidential.
 */
export function buildDealMemoFallback(deal: Deal): string {
  const t = dealTeaser(deal);
  const where = t.geography ? ` in ${t.geography}` : "";
  const size = t.amount ? `, targeting ${t.amount}` : "";
  return (
    `${t.name} is a ${t.sector} opportunity${where}${size}, currently ${t.stage}. ` +
    `Shared confidentially through FundExecs OS — the full deal room opens on request. ` +
    `If the profile fits your mandate, request access to review the underwriting and diligence.`
  );
}

export interface DealAlertCopy {
  subject: string;
  preview: string;
  aiSummary: string;
  intent: string;
}

/**
 * The professional alert dropped into a matched org's bell about a shared deal.
 * Leads with fit, teases the deal, and routes to the teaser — full room gated.
 */
export function buildDealAlertCopy(
  deal: Deal,
  sharerName: string,
  match: InvestorMatch,
): DealAlertCopy {
  const t = dealTeaser(deal);
  const facets = [t.stage, t.sector, t.geography, t.amount].filter(Boolean) as string[];
  return {
    subject: `New deal that fits you — ${deal.name}`,
    preview: facets.join(" · "),
    aiSummary: `${sharerName} shared a deal that fits your mandate (${match.score}/100). ${match.reasons.join(" ")} Open the teaser to review and request the full deal room.`,
    intent: "Deal match",
  };
}
