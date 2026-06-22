// lib/stake.test.ts
// Unit tests for the pure stake math (no database). Pins down that the required
// listing stake scales down with reputation — established/principal operators
// post less — and never goes negative. The DB-touching lock/resolve helpers are
// integration concerns and are deliberately not exercised here.
import { requiredListingStake, BASE_LISTING_STAKE } from "@/lib/stake";
import { profileFromSignals, profileFromScore } from "@/lib/compounding";

describe("requiredListingStake", () => {
  it("charges an unranked org the full base stake", () => {
    const unranked = profileFromSignals({ closedDeals: 0, verifiedRecords: 0, tenureMonths: 0 });
    expect(unranked.requiredStakeMultiplier).toBe(1);
    expect(requiredListingStake(unranked)).toBe(BASE_LISTING_STAKE);
  });

  it("halves the stake for a profile with a 0.5 stake multiplier", () => {
    // principal tier carries requiredStakeMultiplier 0.5.
    const principal = profileFromSignals({ closedDeals: 12, verifiedRecords: 0, tenureMonths: 0 });
    expect(principal.requiredStakeMultiplier).toBe(0.5);
    expect(requiredListingStake(principal)).toBe(Math.round(BASE_LISTING_STAKE * 0.5));
  });

  it("lowers the required stake as reputation rises across tiers", () => {
    const unranked = requiredListingStake(profileFromScore(0, 0)); // mult 1
    const verified = requiredListingStake(profileFromScore(40, 0)); // mult 0.85
    const established = requiredListingStake(profileFromScore(120, 0)); // mult 0.65
    const principal = requiredListingStake(profileFromScore(300, 0)); // mult 0.5
    expect(unranked).toBeGreaterThan(verified);
    expect(verified).toBeGreaterThan(established);
    expect(established).toBeGreaterThan(principal);
  });

  it("rounds to a whole credit", () => {
    const verified = profileFromScore(40, 0); // 250 * 0.85 = 212.5 -> 213
    expect(requiredListingStake(verified)).toBe(213);
    expect(Number.isInteger(requiredListingStake(verified))).toBe(true);
  });

  it("never returns a negative stake", () => {
    // A defensive multiplier below zero can never produce a negative stake.
    const profile = { ...profileFromScore(0, 0), requiredStakeMultiplier: -2 };
    expect(requiredListingStake(profile)).toBe(0);
  });
});
