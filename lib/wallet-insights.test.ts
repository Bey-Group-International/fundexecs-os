import {
  walletRunway,
  formatRunway,
  recommendPlan,
  recommendTopUpPack,
  LOW_BALANCE_FLOOR,
} from "@/lib/wallet-insights";
import { PLANS, CREDIT_PACKS } from "@/lib/billing";

describe("walletRunway", () => {
  it("computes daily burn and runway from a 30-day window", () => {
    const r = walletRunway(300, 300); // 10/day → 30 days
    expect(r.dailyBurn).toBeCloseTo(10, 5);
    expect(r.runwayDays).toBeCloseTo(30, 5);
    expect(r.health).toBe("healthy");
  });

  it("reports no measurable burn as null runway (idle org isn't nagged)", () => {
    const r = walletRunway(5000, 0);
    expect(r.runwayDays).toBeNull();
    expect(r.health).toBe("healthy");
  });

  it("flags critical when the balance is empty", () => {
    expect(walletRunway(0, 0).health).toBe("critical");
  });

  it("flags critical when runway is under 3 days", () => {
    const r = walletRunway(20, 300); // 10/day → 2 days
    expect(r.health).toBe("critical");
  });

  it("flags low when runway is under 10 days", () => {
    const r = walletRunway(70, 300); // 10/day → 7 days
    expect(r.health).toBe("low");
  });

  it("flags low for a tiny balance even without burn", () => {
    const r = walletRunway(LOW_BALANCE_FLOOR - 1, 0);
    expect(r.health).toBe("low");
  });

  it("floors a negative balance at zero", () => {
    const r = walletRunway(-50, 0);
    expect(r.dailyBurn).toBe(0);
    expect(r.health).toBe("critical");
  });
});

describe("formatRunway", () => {
  it("labels the null/edge cases", () => {
    expect(formatRunway(null)).toBe("no recent burn");
    expect(formatRunway(0.5)).toBe("< 1 day");
    expect(formatRunway(8.9)).toBe("≈ 8 days");
    expect(formatRunway(120)).toBe("30+ days");
  });
});

describe("recommendPlan", () => {
  it("defaults to pro with no usage signal", () => {
    const r = recommendPlan(0);
    expect(r.key).toBe("pro");
    expect(r.isUpgrade).toBe(true); // from no plan
  });

  it("picks the smallest plan that covers burn with headroom", () => {
    const starter = PLANS.find((p) => p.key === "starter")!;
    // Just under starter capacity / 1.2 so starter fits.
    const r = recommendPlan(Math.floor(starter.creditsPerMonth / 1.2) - 1);
    expect(r.key).toBe("starter");
  });

  it("falls back to the largest plan when burn exceeds every tier", () => {
    const largest = PLANS[PLANS.length - 1];
    const r = recommendPlan(largest.creditsPerMonth * 5);
    expect(r.key).toBe(largest.key);
  });

  it("marks a same-or-lower tier as not an upgrade", () => {
    const largest = PLANS[PLANS.length - 1];
    const r = recommendPlan(0, largest.key); // recommends pro, current is largest
    expect(r.isUpgrade).toBe(false);
  });
});

describe("recommendTopUpPack", () => {
  it("returns null when the balance already covers the month", () => {
    expect(recommendTopUpPack(10_000, 500)).toBeNull();
    expect(recommendTopUpPack(0, 0)).toBeNull();
  });

  it("suggests the smallest pack that bridges the gap", () => {
    const smallest = [...CREDIT_PACKS].sort((a, b) => a.credits - b.credits)[0];
    const r = recommendTopUpPack(0, smallest.credits); // gap == smallest.credits
    expect(r?.credits).toBe(smallest.credits);
  });

  it("suggests the largest pack when the gap exceeds all packs", () => {
    const largest = [...CREDIT_PACKS].sort((a, b) => a.credits - b.credits).at(-1)!;
    const r = recommendTopUpPack(0, largest.credits * 10);
    expect(r?.credits).toBe(largest.credits);
  });
});
