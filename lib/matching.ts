// lib/matching.ts
// The matching engine — the connective tissue that lets the Marketplace and the
// Capital Map compound on each other. It scores how well a given investor fits a
// given marketplace listing, reusing the same first-party signals the Capital
// Map already trusts: the investor's check-size band, their jurisdiction, and
// their type. Pure computation (no DB, no I/O) so the same scoring holds on the
// Marketplace ("who should I take this to?") and the Capital Map ("what live
// listings fit this LP?"), and so it is trivially unit-testable.
import type { Investor, MarketplaceListing } from "@/lib/supabase/database.types";

// Optional enrichment resolved from a listing's linked deal/fund. When a listing
// is tied to a deal we can match on geography and asset class too; without it we
// fall back to amount + investor type.
export interface ListingContext {
  geography?: string | null;
  assetClass?: string | null;
}

export interface MatchScore {
  // 0..100 — how well this investor fits this listing.
  score: number;
  reasons: string[];
}

export interface InvestorMatch {
  investor: Investor;
  score: number;
  reasons: string[];
}

export interface ListingMatch {
  listing: MarketplaceListing;
  score: number;
  reasons: string[];
}

function humanizeType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// listing_type → which investor types are the natural buyers, and how strongly
// (0..25). Allocators that anchor primaries score highest on funds; family
// offices and co-GPs lean into direct deals and co-invests.
const TYPE_AFFINITY: Record<string, Partial<Record<string, number>>> = {
  fund: { institution: 25, fund_of_funds: 25, lp: 22, family_office: 18, bank: 10 },
  deal: { family_office: 25, fund_of_funds: 18, co_gp: 22, institution: 18, lp: 14 },
  co_invest: { family_office: 25, co_gp: 25, institution: 20, fund_of_funds: 18, lp: 14 },
  secondary: { fund_of_funds: 25, institution: 22, family_office: 18, lp: 18 },
  service: { co_gp: 12, family_office: 8 },
};

// Score one investor against one listing. The bands mirror the Capital Map's
// thesis-fit weighting so the two surfaces feel like one instrument:
//   check-size fit  → up to 45
//   geography       → up to 30
//   type affinity   → up to 25
export function scoreInvestorForListing(
  investor: Investor,
  listing: MarketplaceListing,
  ctx: ListingContext = {},
): MatchScore {
  const reasons: string[] = [];
  let score = 0;

  // Check-size fit (up to 45). Does the listing's allocation sit inside the
  // investor's typical check band?
  const amount = listing.amount;
  const min = investor.typical_check_min;
  const max = investor.typical_check_max;
  if (amount != null && (min != null || max != null)) {
    const lo = min ?? 0;
    const hi = max ?? Number.POSITIVE_INFINITY;
    if (amount >= lo && amount <= hi) {
      score += 45;
      reasons.push("Allocation fits their check size.");
    } else if (amount <= hi) {
      score += 30;
      reasons.push("Sits within their check ceiling.");
    } else if (amount < lo) {
      score += 15;
      reasons.push("Below their typical check — a small ticket for them.");
    } else {
      score += 5;
      reasons.push("Above their typical check — they'd have to stretch.");
    }
  } else {
    // No amount or no band on file — neutral partial credit, not a penalty.
    score += 18;
  }

  // Geography (up to 30). Only when the listing carries a geography (via its
  // linked deal) and the investor names a jurisdiction.
  if (ctx.geography && investor.jurisdiction) {
    const g = ctx.geography.toLowerCase();
    const j = investor.jurisdiction.toLowerCase();
    if (g.includes(j) || j.includes(g)) {
      score += 30;
      reasons.push(`Based in the deal's geography (${investor.jurisdiction}).`);
    }
  }

  // Type affinity (up to 25). Is this the kind of buyer that takes this kind of
  // listing?
  const affinity = TYPE_AFFINITY[listing.listing_type] ?? {};
  const typePts = affinity[investor.investor_type] ?? 0;
  if (typePts > 0) {
    score += typePts;
    reasons.push(`${humanizeType(investor.investor_type)} — a natural fit for a ${humanizeType(listing.listing_type).toLowerCase()}.`);
  }

  return { score: Math.min(100, Math.round(score)), reasons };
}

// Rank a pool of investors for one listing, hottest fit first. `minScore` drops
// weak matches; `limit` caps the surfaced set.
export function rankInvestorsForListing(
  listing: MarketplaceListing,
  investors: Investor[],
  opts: { ctx?: ListingContext; minScore?: number; limit?: number } = {},
): InvestorMatch[] {
  const { ctx = {}, minScore = 40, limit = 5 } = opts;
  return investors
    .map((investor) => {
      const { score, reasons } = scoreInvestorForListing(investor, listing, ctx);
      return { investor, score, reasons };
    })
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Rank live listings for one investor — the inverse view used on the Capital
// Map to show "what current opportunities fit this LP?". `contextFor` resolves a
// listing's geography/asset class when available. `boostFor` lets the caller add
// the listing owner's compounding match-boost (see lib/compounding.ts), so that
// among comparable fits, listings from reputable, proven operators surface first
// — quality compounds in discovery, not just in access. The boost is applied
// AFTER fit so it only ever breaks ties between genuinely-suitable listings; the
// final score stays clamped to 100.
export function rankListingsForInvestor(
  investor: Investor,
  listings: MarketplaceListing[],
  opts: {
    contextFor?: (listing: MarketplaceListing) => ListingContext;
    boostFor?: (listing: MarketplaceListing) => number;
    minScore?: number;
    limit?: number;
  } = {},
): ListingMatch[] {
  const { contextFor, boostFor, minScore = 45, limit = 3 } = opts;
  return listings
    .map((listing) => {
      const ctx = contextFor ? contextFor(listing) : {};
      const { score, reasons } = scoreInvestorForListing(investor, listing, ctx);
      // Only reward reputation on listings that already clear the fit bar, so it
      // surfaces good operators rather than rescuing poor matches.
      const boost = score >= minScore ? Math.max(0, boostFor?.(listing) ?? 0) : 0;
      const boosted = Math.min(100, score + boost);
      if (boost > 0) reasons.push("Proven operator — boosted by track record.");
      return { listing, score: boosted, reasons };
    })
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
