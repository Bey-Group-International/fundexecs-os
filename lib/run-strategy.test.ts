// lib/run-strategy.test.ts
// Unit tests for the pure Run-hub strategy layer (allocation + prioritization).
// No database is hit — we build small in-memory DealConviction fixtures rather
// than going through getRunConviction (whose `cache` wrapper is unavailable in
// jest), so only the pure functions are exercised.
import {
  clampUnit,
  matchesBucket,
  computeAllocation,
  prioritize,
  focusNext,
} from "@/lib/run-strategy";
import type { DealConviction } from "@/lib/run-conviction";
import type { Mandate } from "@/lib/build-readiness";
import type { Deal } from "@/lib/supabase/database.types";

// --- Fixtures ---------------------------------------------------------------
function makeDeal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "deal-1",
    organization_id: "org-1",
    name: "Project Atlas",
    stage: "diligence",
    asset_class: "real_estate",
    geography: "US",
    target_amount: null,
    fund_id: null,
    source: null,
    lead_principal: null,
    thesis_fit: 0.8,
    expected_close: null,
    notes: null,
    session_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// A minimal DealConviction — only the fields the strategy layer reads need to be
// real; the rest are filled with inert defaults.
function makeConviction(deal: Deal, score: number): DealConviction {
  return {
    deal,
    score,
    stage: { key: "building", label: "Building", tone: "" },
    checks: [],
    doneCount: 0,
    total: 0,
    baseCase: null,
    cases: [],
    diligence: [],
    coverage: 0,
    openRisks: [],
    projectedIrr: null,
    projectedMoic: null,
  };
}

const MANDATE: Mandate = {
  thesisTitle: "Core-plus US RE",
  assetClasses: ["real_estate", "infrastructure"],
  geographies: ["US", "EU"],
  checkSizeMin: null,
  checkSizeMax: null,
  targetIrr: 18,
  targetMoic: 2,
};

// --- clampUnit --------------------------------------------------------------
describe("clampUnit", () => {
  it("passes an in-range value through", () => {
    expect(clampUnit(0.42)).toBe(0.42);
  });
  it("clamps below 0 and above 1", () => {
    expect(clampUnit(-0.5)).toBe(0);
    expect(clampUnit(1.7)).toBe(1);
  });
  it("passes null / NaN through as null", () => {
    expect(clampUnit(null)).toBeNull();
    expect(clampUnit(Number.NaN)).toBeNull();
  });
});

// --- matchesBucket ----------------------------------------------------------
describe("matchesBucket", () => {
  it("matches case-insensitively when either contains the other", () => {
    expect(matchesBucket("Real Estate", "real_estate")).toBe(false); // underscore vs space
    expect(matchesBucket("real_estate", "real_estate")).toBe(true);
    expect(matchesBucket("US Real Estate", "real")).toBe(true);
  });
  it("does not match a null or empty value", () => {
    expect(matchesBucket(null, "US")).toBe(false);
    expect(matchesBucket("US", "")).toBe(false);
  });
});

// --- computeAllocation ------------------------------------------------------
describe("computeAllocation", () => {
  it("counts and shares deals by asset class and geography", () => {
    const deals = [
      makeConviction(makeDeal({ id: "a", asset_class: "real_estate", geography: "US" }), 70),
      makeConviction(makeDeal({ id: "b", asset_class: "real_estate", geography: "EU" }), 60),
      makeConviction(makeDeal({ id: "c", asset_class: "credit", geography: "US" }), 50),
    ];
    const a = computeAllocation(deals, MANDATE);
    expect(a.total).toBe(3);

    const re = a.byAssetClass.slices.find((s) => s.label === "real_estate")!;
    expect(re.count).toBe(2);
    expect(re.share).toBeCloseTo(2 / 3);

    const us = a.byGeography.slices.find((s) => s.label === "US")!;
    expect(us.count).toBe(2);
  });

  it("flags a majority slice as concentrated", () => {
    const deals = [
      makeConviction(makeDeal({ id: "a", asset_class: "real_estate" }), 70),
      makeConviction(makeDeal({ id: "b", asset_class: "real_estate" }), 60),
      makeConviction(makeDeal({ id: "c", asset_class: "real_estate" }), 50),
      makeConviction(makeDeal({ id: "d", asset_class: "credit" }), 40),
    ];
    const a = computeAllocation(deals, MANDATE);
    const re = a.byAssetClass.slices.find((s) => s.label === "real_estate")!;
    const credit = a.byAssetClass.slices.find((s) => s.label === "credit")!;
    expect(re.concentrated).toBe(true); // 3/4 = 75%
    expect(credit.concentrated).toBe(false);
  });

  it("does not flag concentration when the pipeline is a single deal", () => {
    const deals = [makeConviction(makeDeal({ id: "a", asset_class: "real_estate" }), 70)];
    const a = computeAllocation(deals, MANDATE);
    expect(a.byAssetClass.slices[0].concentrated).toBe(false);
  });

  it("reports mandate buckets with no covering deal as gaps", () => {
    const deals = [
      makeConviction(makeDeal({ id: "a", asset_class: "real_estate", geography: "US" }), 70),
    ];
    const a = computeAllocation(deals, MANDATE);
    expect(a.byAssetClass.gaps.map((g) => g.label)).toEqual(["infrastructure"]);
    expect(a.byGeography.gaps.map((g) => g.label)).toEqual(["EU"]);
  });

  it("counts deals missing a value as unspecified, not as gaps", () => {
    const deals = [
      makeConviction(makeDeal({ id: "a", asset_class: null, geography: "US" }), 70),
      makeConviction(makeDeal({ id: "b", asset_class: "real_estate", geography: null }), 60),
    ];
    const a = computeAllocation(deals, MANDATE);
    expect(a.byAssetClass.unspecified).toBe(1);
    expect(a.byGeography.unspecified).toBe(1);
  });

  it("returns no gaps when there is no mandate", () => {
    const deals = [makeConviction(makeDeal({ id: "a" }), 70)];
    const a = computeAllocation(deals, null);
    expect(a.byAssetClass.gaps).toHaveLength(0);
    expect(a.byGeography.gaps).toHaveLength(0);
  });
});

// --- prioritize -------------------------------------------------------------
describe("prioritize", () => {
  it("ranks higher conviction ahead of lower, all else equal", () => {
    const deals = [
      makeConviction(makeDeal({ id: "low", name: "Low", thesis_fit: 0.8 }), 40),
      makeConviction(makeDeal({ id: "high", name: "High", thesis_fit: 0.8 }), 90),
    ];
    const ranked = prioritize(deals);
    expect(ranked[0].conviction.deal.id).toBe("high");
    expect(ranked[0].priority).toBeGreaterThan(ranked[1].priority);
  });

  it("lets thesis fit tilt the ranking between equal-conviction deals", () => {
    const deals = [
      makeConviction(makeDeal({ id: "poorfit", name: "Poor", thesis_fit: 0.2 }), 70),
      makeConviction(makeDeal({ id: "goodfit", name: "Good", thesis_fit: 0.95 }), 70),
    ];
    const ranked = prioritize(deals);
    expect(ranked[0].conviction.deal.id).toBe("goodfit");
  });

  it("treats an unscored thesis fit as neutral rather than zero", () => {
    const unscored = prioritize([makeConviction(makeDeal({ thesis_fit: null }), 70)])[0];
    expect(unscored.factors.fit).toBe(0.5);
  });

  it("gives larger relative check size a higher size factor", () => {
    const deals = [
      makeConviction(makeDeal({ id: "big", name: "Big", target_amount: 100_000_000, thesis_fit: 0.5 }), 70),
      makeConviction(makeDeal({ id: "small", name: "Small", target_amount: 25_000_000, thesis_fit: 0.5 }), 70),
    ];
    const ranked = prioritize(deals);
    expect(ranked[0].conviction.deal.id).toBe("big");
    const big = ranked.find((r) => r.conviction.deal.id === "big")!;
    const small = ranked.find((r) => r.conviction.deal.id === "small")!;
    expect(big.factors.size).toBe(1);
    expect(small.factors.size).toBeCloseTo(0.25);
  });

  it("does not mutate the input array order", () => {
    const deals = [
      makeConviction(makeDeal({ id: "a", name: "A" }), 10),
      makeConviction(makeDeal({ id: "b", name: "B" }), 90),
    ];
    prioritize(deals);
    expect(deals[0].deal.id).toBe("a");
  });

  it("returns an empty array for an empty working set", () => {
    expect(prioritize([])).toEqual([]);
  });
});

// --- focusNext --------------------------------------------------------------
describe("focusNext", () => {
  it("returns the single highest-priority deal", () => {
    const deals = [
      makeConviction(makeDeal({ id: "a", name: "A", thesis_fit: 0.5 }), 30),
      makeConviction(makeDeal({ id: "b", name: "B", thesis_fit: 0.9 }), 88),
    ];
    expect(focusNext(deals)?.conviction.deal.id).toBe("b");
  });
  it("returns null when there are no deals", () => {
    expect(focusNext([])).toBeNull();
  });
});
