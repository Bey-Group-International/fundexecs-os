// lib/referrals.test.ts
import {
  directReward,
  levelOverride,
  milestoneAt,
  rankFor,
  isReferralEarning,
  DIRECT_TIERS,
  MAX_LEVEL,
} from "@/lib/referrals";

describe("directReward", () => {
  it("escalates with the referrer's cumulative direct count", () => {
    // Tiers: 1–2 → 500, 3–5 → 700, 6–9 → 900, 10+ → 1200.
    expect(directReward(1)).toBe(500);
    expect(directReward(2)).toBe(500);
    expect(directReward(3)).toBe(700);
    expect(directReward(5)).toBe(700);
    expect(directReward(6)).toBe(900);
    expect(directReward(9)).toBe(900);
    expect(directReward(10)).toBe(1_200);
    expect(directReward(100)).toBe(1_200);
  });

  it("never pays less for a later referral than an earlier one (monotonic)", () => {
    let prev = 0;
    for (let n = 1; n <= 30; n++) {
      const r = directReward(n);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it("caps at the final tier's reward", () => {
    const top = DIRECT_TIERS[DIRECT_TIERS.length - 1].reward;
    expect(directReward(1000)).toBe(top);
  });
});

describe("levelOverride", () => {
  it("pays decaying overrides for downline depth and nothing past MAX_LEVEL", () => {
    expect(levelOverride(2)).toBe(100);
    expect(levelOverride(3)).toBe(50);
    expect(levelOverride(MAX_LEVEL + 1)).toBe(0);
    // Level 1 is paid via tiers, not the override table.
    expect(levelOverride(1)).toBe(0);
  });
});

describe("milestoneAt", () => {
  it("fires only exactly at a milestone count", () => {
    expect(milestoneAt(3)?.bonus).toBe(500);
    expect(milestoneAt(5)?.bonus).toBe(1_000);
    expect(milestoneAt(10)?.bonus).toBe(3_000);
    expect(milestoneAt(25)?.bonus).toBe(10_000);
    expect(milestoneAt(4)).toBeNull();
    expect(milestoneAt(1)).toBeNull();
  });
});

describe("rankFor", () => {
  it("starts at Scout with progress toward the first milestone", () => {
    const r = rankFor(0);
    expect(r.rank).toBe("Scout");
    expect(r.next?.count).toBe(3);
    expect(r.progress).toBeCloseTo(0, 10);
  });

  it("advances rank and reports progress between milestones", () => {
    const r = rankFor(4); // past Connector(3), toward Rainmaker(5)
    expect(r.rank).toBe("Connector");
    expect(r.next?.rank).toBe("Rainmaker");
    expect(r.progress).toBeCloseTo((4 - 3) / (5 - 3), 10);
  });

  it("tops out with full progress and no next milestone", () => {
    const r = rankFor(30);
    expect(r.rank).toBe("Legend");
    expect(r.next).toBeNull();
    expect(r.progress).toBe(1);
  });
});

describe("isReferralEarning", () => {
  it("recognizes referral ledger reasons and rejects others", () => {
    expect(isReferralEarning("referral_direct")).toBe(true);
    expect(isReferralEarning("referral_override")).toBe(true);
    expect(isReferralEarning("referral_milestone")).toBe(true);
    expect(isReferralEarning("referral_welcome")).toBe(true);
    expect(isReferralEarning("gift_received")).toBe(false);
    expect(isReferralEarning("spend")).toBe(false);
  });
});
