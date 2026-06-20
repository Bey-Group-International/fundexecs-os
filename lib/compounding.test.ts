// lib/compounding.test.ts
// Unit tests for the pure compounding math (no database). These pin down the
// guardrails that keep the model institutional: merit dominates, loyalty is
// bounded, and discounts never run away.
import {
  reputationScore,
  tierForScore,
  profileFromSignals,
  profileFromScore,
  effectiveCost,
  UNRANKED_PROFILE,
  type CompoundingSignals,
} from "@/lib/compounding";

function signals(overrides: Partial<CompoundingSignals> = {}): CompoundingSignals {
  return { closedDeals: 0, verifiedRecords: 0, tenureMonths: 0, ...overrides };
}

describe("reputationScore", () => {
  it("is zero for a fresh org", () => {
    expect(reputationScore(signals())).toBe(0);
  });

  it("rewards closed deals most heavily", () => {
    expect(reputationScore(signals({ closedDeals: 2 }))).toBe(50);
  });

  it("caps the contribution of verified records so they can't substitute for closes", () => {
    const many = reputationScore(signals({ verifiedRecords: 1000 }));
    const fewCloses = reputationScore(signals({ closedDeals: 3 }));
    expect(many).toBeLessThan(fewCloses);
  });

  it("ignores negative signal counts", () => {
    expect(reputationScore(signals({ closedDeals: -5, verifiedRecords: -2 }))).toBe(0);
  });
});

describe("tierForScore", () => {
  it("maps score bands to tiers", () => {
    expect(tierForScore(0)).toBe("unranked");
    expect(tierForScore(40)).toBe("verified");
    expect(tierForScore(120)).toBe("established");
    expect(tierForScore(300)).toBe("principal");
    expect(tierForScore(10_000)).toBe("principal");
  });
});

describe("profileFromSignals — guardrails", () => {
  it("gives an unranked org no discount or boost", () => {
    const p = profileFromSignals(signals());
    expect(p.tier).toBe("unranked");
    expect(p.priceMultiplier).toBe(1);
    expect(p.discountPct).toBe(0);
    expect(p.matchBoost).toBe(0);
    expect(p.requiredStakeMultiplier).toBe(1);
  });

  it("lets merit dominate loyalty", () => {
    // Max tenure alone vs. a real track record: the discount from closing deals
    // must exceed the discount from simply sticking around.
    const loyalOnly = profileFromSignals(signals({ tenureMonths: 1000 }));
    const proven = profileFromSignals(signals({ closedDeals: 12 }));
    expect(proven.factors.meritPct).toBeGreaterThan(loyalOnly.factors.loyaltyPct);
    expect(proven.priceMultiplier).toBeLessThan(loyalOnly.priceMultiplier);
  });

  it("caps loyalty at 5% even at extreme tenure", () => {
    const p = profileFromSignals(signals({ tenureMonths: 100_000 }));
    expect(p.factors.loyaltyPct).toBeLessThanOrEqual(5);
  });

  it("never discounts more than the all-in floor of 25%", () => {
    const p = profileFromSignals(signals({ closedDeals: 50, tenureMonths: 100_000 }));
    expect(p.priceMultiplier).toBeGreaterThanOrEqual(0.75);
    expect(p.discountPct).toBeLessThanOrEqual(25);
  });

  it("lowers the required stake as reputation rises", () => {
    const unranked = profileFromSignals(signals());
    const principal = profileFromSignals(signals({ closedDeals: 12 }));
    expect(principal.requiredStakeMultiplier).toBeLessThan(unranked.requiredStakeMultiplier);
  });
});

describe("profileFromScore — Phase 1 stored-score path", () => {
  it("agrees with the proxy path for an equivalent merit score", () => {
    // Two closed deals via the proxy == a stored score of 50.
    const proxy = profileFromSignals({ closedDeals: 2, verifiedRecords: 0, tenureMonths: 0 });
    const stored = profileFromScore(50, 0);
    expect(stored.tier).toBe(proxy.tier);
    expect(stored.priceMultiplier).toBe(proxy.priceMultiplier);
    expect(stored.matchBoost).toBe(proxy.matchBoost);
  });

  it("applies tenure loyalty on top of a stored score", () => {
    const noTenure = profileFromScore(50, 0);
    const tenured = profileFromScore(50, 1000);
    expect(tenured.factors.loyaltyPct).toBeGreaterThan(noTenure.factors.loyaltyPct);
    expect(tenured.priceMultiplier).toBeLessThan(noTenure.priceMultiplier);
  });
});

describe("effectiveCost", () => {
  it("applies the discount and rounds to whole credits", () => {
    const proven = profileFromSignals(signals({ closedDeals: 12 })); // principal, 20% merit
    expect(effectiveCost(100, proven)).toBe(80);
  });

  it("never charges below 1 credit for a positive base", () => {
    const proven = profileFromSignals(signals({ closedDeals: 50, tenureMonths: 100_000 }));
    expect(effectiveCost(1, proven)).toBe(1);
  });

  it("charges full price for an unranked org", () => {
    expect(effectiveCost(100, UNRANKED_PROFILE)).toBe(100);
  });

  it("treats a zero/negative base as free", () => {
    expect(effectiveCost(0, UNRANKED_PROFILE)).toBe(0);
    expect(effectiveCost(-10, UNRANKED_PROFILE)).toBe(0);
  });
});
