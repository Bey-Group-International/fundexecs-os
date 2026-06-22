// lib/matching.test.ts
// Unit tests for the marketplace ↔ investor matching engine. Pure functions, so
// every fixture is a small in-memory object — no database is touched.
import {
  scoreInvestorForListing,
  rankInvestorsForListing,
  rankListingsForInvestor,
} from "@/lib/matching";
import type { Investor, MarketplaceListing } from "@/lib/supabase/database.types";

function makeInvestor(overrides: Partial<Investor> = {}): Investor {
  return {
    id: "inv-1",
    organization_id: "org-1",
    name: "Acme Family Office",
    investor_type: "family_office",
    contact_name: null,
    contact_email: null,
    jurisdiction: null,
    aum: null,
    typical_check_min: null,
    typical_check_max: null,
    notes: null,
    pipeline_stage: "new",
    session_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    provenance: "manual",
    verification_status: "unverified",
    verified_at: null,
    verified_by: null,
    verification_note: null,
    archived_at: null,
    ...overrides,
  };
}

function makeListing(overrides: Partial<MarketplaceListing> = {}): MarketplaceListing {
  return {
    id: "lst-1",
    organization_id: "org-1",
    title: "Series B secondary",
    listing_type: "secondary",
    summary: null,
    deal_id: null,
    fund_id: null,
    amount: null,
    status: "listed",
    is_public: true,
    metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("scoreInvestorForListing", () => {
  it("rewards an allocation that fits the investor's check band", () => {
    const investor = makeInvestor({ typical_check_min: 1_000_000, typical_check_max: 10_000_000 });
    const listing = makeListing({ listing_type: "deal", amount: 4_000_000 });
    const { score, reasons } = scoreInvestorForListing(investor, listing);
    expect(score).toBeGreaterThanOrEqual(45);
    expect(reasons.join(" ")).toMatch(/fits their check/i);
  });

  it("flags an allocation above the investor's ceiling", () => {
    const investor = makeInvestor({ typical_check_min: 1_000_000, typical_check_max: 5_000_000 });
    const listing = makeListing({ amount: 50_000_000, listing_type: "deal" });
    const { reasons } = scoreInvestorForListing(investor, listing);
    expect(reasons.join(" ")).toMatch(/stretch/i);
  });

  it("adds geography credit when the deal geography matches the jurisdiction", () => {
    const investor = makeInvestor({ jurisdiction: "United States" });
    const listing = makeListing({ amount: null });
    const withGeo = scoreInvestorForListing(investor, listing, { geography: "United States" });
    const withoutGeo = scoreInvestorForListing(investor, listing, {});
    expect(withGeo.score).toBeGreaterThan(withoutGeo.score);
    expect(withGeo.reasons.join(" ")).toMatch(/geography/i);
  });

  it("weights type affinity by listing type", () => {
    const fo = makeInvestor({ investor_type: "family_office" });
    const lender = makeInvestor({ investor_type: "lender" });
    const coInvest = makeListing({ listing_type: "co_invest" });
    expect(scoreInvestorForListing(fo, coInvest).score).toBeGreaterThan(
      scoreInvestorForListing(lender, coInvest).score,
    );
  });

  it("never exceeds 100", () => {
    const investor = makeInvestor({
      investor_type: "institution",
      jurisdiction: "Europe",
      typical_check_min: 1_000_000,
      typical_check_max: 100_000_000,
    });
    const listing = makeListing({ listing_type: "fund", amount: 10_000_000 });
    const { score } = scoreInvestorForListing(investor, listing, { geography: "Europe" });
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("rankInvestorsForListing", () => {
  it("returns matches sorted high-to-low and drops weak fits", () => {
    const strong = makeInvestor({
      id: "strong",
      investor_type: "fund_of_funds",
      typical_check_min: 1_000_000,
      typical_check_max: 20_000_000,
    });
    const weak = makeInvestor({ id: "weak", investor_type: "lender", typical_check_max: 100 });
    const listing = makeListing({ listing_type: "fund", amount: 5_000_000 });
    const ranked = rankInvestorsForListing(listing, [weak, strong], { minScore: 40 });
    expect(ranked[0].investor.id).toBe("strong");
    expect(ranked.every((m) => m.score >= 40)).toBe(true);
  });

  it("respects the limit", () => {
    const investors = Array.from({ length: 10 }, (_, i) =>
      makeInvestor({ id: `i${i}`, investor_type: "family_office", typical_check_max: 10_000_000 }),
    );
    const listing = makeListing({ listing_type: "co_invest", amount: 1_000_000 });
    expect(rankInvestorsForListing(listing, investors, { limit: 3 }).length).toBe(3);
  });
});

describe("rankListingsForInvestor", () => {
  it("surfaces the best-fitting live listings for an investor", () => {
    const investor = makeInvestor({
      investor_type: "family_office",
      typical_check_min: 1_000_000,
      typical_check_max: 10_000_000,
    });
    const good = makeListing({ id: "good", listing_type: "co_invest", amount: 3_000_000 });
    const bad = makeListing({ id: "bad", listing_type: "service", amount: 500_000_000 });
    const ranked = rankListingsForInvestor(investor, [bad, good], { minScore: 45 });
    expect(ranked[0]?.listing.id).toBe("good");
  });
});
