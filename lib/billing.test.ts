// lib/billing.test.ts
import {
  PLAN_BY_KEY,
  planGrantCredits,
  annualSavingsUsd,
  annualSavingsPct,
  loyaltyBonus,
  tenureMonths,
  planSeatLimit,
  seatLimitReached,
  FREE_PLAN_SEATS,
  LOYALTY_STEP,
  LOYALTY_CAP,
} from "@/lib/billing";

describe("planGrantCredits", () => {
  it("front-loads a full year of credits on annual, one month on monthly", () => {
    const pro = PLAN_BY_KEY.pro;
    expect(planGrantCredits(pro, "monthly")).toBe(pro.creditsPerMonth);
    expect(planGrantCredits(pro, "annual")).toBe(pro.creditsPerMonth * 12);
  });
});

describe("annual savings", () => {
  it("annual price saves two months versus paying monthly", () => {
    const scale = PLAN_BY_KEY.scale; // monthly 100, annual 1000
    expect(annualSavingsUsd(scale)).toBe(100 * 12 - 1000); // 200
    expect(annualSavingsPct(scale)).toBe(17); // 200 / 1200 ≈ 17%
  });
});

describe("loyaltyBonus", () => {
  it("grows per month of tenure and caps", () => {
    expect(loyaltyBonus(0)).toBe(0);
    expect(loyaltyBonus(1)).toBe(LOYALTY_STEP);
    expect(loyaltyBonus(3)).toBe(LOYALTY_STEP * 3);
    expect(loyaltyBonus(10_000)).toBe(LOYALTY_CAP);
  });

  it("ignores fractional and negative months", () => {
    expect(loyaltyBonus(2.9)).toBe(LOYALTY_STEP * 2);
    expect(loyaltyBonus(-5)).toBe(0);
  });
});

describe("planSeatLimit", () => {
  it("returns each plan's seat allotment", () => {
    expect(planSeatLimit("starter")).toBe(1);
    expect(planSeatLimit("pro")).toBe(10);
    expect(planSeatLimit("scale")).toBeNull(); // unlimited
  });

  it("falls back to the free allotment for no plan or unknown keys", () => {
    expect(planSeatLimit(null)).toBe(FREE_PLAN_SEATS);
    expect(planSeatLimit(undefined)).toBe(FREE_PLAN_SEATS);
    expect(planSeatLimit("enterprise")).toBe(FREE_PLAN_SEATS);
  });
});

describe("seatLimitReached", () => {
  it("blocks at or above the plan's seat count", () => {
    expect(seatLimitReached("starter", 0)).toBe(false);
    expect(seatLimitReached("starter", 1)).toBe(true);
    expect(seatLimitReached("pro", 9)).toBe(false);
    expect(seatLimitReached("pro", 10)).toBe(true);
    expect(seatLimitReached("pro", 12)).toBe(true); // over (e.g. after downgrade)
  });

  it("never blocks on an unlimited plan", () => {
    expect(seatLimitReached("scale", 0)).toBe(false);
    expect(seatLimitReached("scale", 10_000)).toBe(false);
  });

  it("treats no plan as the free allotment", () => {
    expect(seatLimitReached(null, 0)).toBe(false);
    expect(seatLimitReached(null, FREE_PLAN_SEATS)).toBe(true);
  });
});

describe("tenureMonths", () => {
  it("returns 0 for missing or future dates", () => {
    expect(tenureMonths(null)).toBe(0);
    expect(tenureMonths(undefined)).toBe(0);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(tenureMonths(future)).toBe(0);
  });

  it("counts whole elapsed months", () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();
    expect(tenureMonths(ninetyDaysAgo)).toBeGreaterThanOrEqual(2);
  });
});
