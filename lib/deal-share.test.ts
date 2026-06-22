// lib/deal-share.test.ts
// Unit tests for the deal-sharing core: the deal→listing adapter, the
// AngelList-style structured match (via lib/matching), the teaser/memo, and the
// alert copy. Pure functions, so every fixture is a small in-memory object.
import {
  dealToListing,
  rankInvestorMatchesForDeal,
  dealTeaser,
  buildDealMemoFallback,
  buildDealAlertCopy,
  fmtUsd,
} from "@/lib/deal-share";
import type { Deal, Investor } from "@/lib/supabase/database.types";

function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "deal-1",
    organization_id: "org-1",
    name: "Harbor Logistics Park",
    stage: "diligence",
    asset_class: "real_estate",
    geography: "New York",
    target_amount: 5_000_000,
    fund_id: null,
    source: "broker",
    lead_principal: null,
    thesis_fit: null,
    expected_close: null,
    notes: "confidential internal notes",
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

function makeInvestor(overrides: Partial<Investor> = {}): Investor {
  return {
    id: "inv-1",
    organization_id: "org-2",
    name: "Harbor Family Office",
    investor_type: "family_office",
    contact_name: null,
    contact_email: null,
    jurisdiction: "New York",
    aum: null,
    typical_check_min: 1_000_000,
    typical_check_max: 10_000_000,
    notes: null,
    pipeline_stage: "prospect",
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

describe("dealToListing", () => {
  it("adapts a deal into a 'deal' listing carrying its target allocation", () => {
    const listing = dealToListing(makeDeal({ target_amount: 7_500_000 }));
    expect(listing.listing_type).toBe("deal");
    expect(listing.amount).toBe(7_500_000);
    expect(listing.deal_id).toBe("deal-1");
    expect(listing.organization_id).toBe("org-1");
  });
});

describe("rankInvestorMatchesForDeal", () => {
  it("ranks a well-fit investor highly (check size + geography + type affinity)", () => {
    const matches = rankInvestorMatchesForDeal(makeDeal(), [makeInvestor()]);
    expect(matches).toHaveLength(1);
    // check-size in band (45) + geography NY (30) + family_office↔deal (25) = 100.
    expect(matches[0].score).toBe(100);
    expect(matches[0].reasons.length).toBeGreaterThan(0);
  });

  it("drops investors below the alert threshold", () => {
    const weak = makeInvestor({
      id: "inv-weak",
      investor_type: "other", // no deal-type affinity
      jurisdiction: "Tokyo",
      typical_check_min: null,
      typical_check_max: null,
    });
    const matches = rankInvestorMatchesForDeal(makeDeal(), [weak], { minScore: 50 });
    expect(matches).toHaveLength(0);
  });

  it("sorts strongest first and respects the limit", () => {
    const strong = makeInvestor({ id: "s", name: "Strong FO" });
    const mid = makeInvestor({
      id: "m",
      name: "Mid Inst",
      investor_type: "institution",
      jurisdiction: "Texas",
    });
    const ranked = rankInvestorMatchesForDeal(makeDeal(), [mid, strong], { limit: 1 });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].investor.id).toBe("s");
  });
});

describe("dealTeaser & fmtUsd", () => {
  it("exposes only confidential-safe facets (no notes/source)", () => {
    const t = dealTeaser(makeDeal());
    expect(t).toEqual({
      name: "Harbor Logistics Park",
      stage: "in diligence",
      sector: "real estate",
      geography: "New York",
      amount: "$5.0M",
    });
    expect(JSON.stringify(t)).not.toMatch(/confidential internal notes|broker/);
  });

  it("formats USD compactly", () => {
    expect(fmtUsd(5_000_000)).toBe("$5.0M");
    expect(fmtUsd(750_000)).toBe("$750K");
    expect(fmtUsd(1_500_000_000)).toBe("$1.5B");
    expect(fmtUsd(null)).toBeNull();
  });
});

describe("memo & alert copy", () => {
  it("builds a deterministic teaser memo from public facts", () => {
    const memo = buildDealMemoFallback(makeDeal());
    expect(memo).toContain("Harbor Logistics Park");
    expect(memo).toContain("real estate");
    expect(memo).toMatch(/deal room/i);
    expect(memo).not.toContain("confidential internal notes");
  });

  it("builds an inbound alert that leads with fit and leaks no contact info", () => {
    const match = rankInvestorMatchesForDeal(makeDeal(), [makeInvestor()])[0];
    const copy = buildDealAlertCopy(makeDeal(), "Northwind Partners", match);
    expect(copy.subject).toContain("Harbor Logistics Park");
    expect(copy.intent).toBe("Deal match");
    expect(copy.aiSummary).toContain("100/100");
    expect(copy.aiSummary).toMatch(/deal room/i);
    expect(copy.preview).not.toMatch(/@/);
  });
});
