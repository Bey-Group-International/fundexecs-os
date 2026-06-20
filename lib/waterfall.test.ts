// lib/waterfall.test.ts — pure waterfall math, no I/O.
import { computeWaterfall, allocateToHolders, DEFAULT_TERMS } from "@/lib/waterfall";

describe("computeWaterfall", () => {
  it("returns only capital when the distribution is below paid-in", () => {
    const w = computeWaterfall(600_000, 1_000_000, DEFAULT_TERMS);
    expect(w.tiers.find((t) => t.key === "roc")!.toLps).toBe(600_000);
    expect(w.totalToGp).toBe(0);
    expect(w.totalToLps).toBe(600_000);
  });

  it("pays return of capital, then the preferred return, before any GP carry", () => {
    // paid-in 1M, 8% pref for 1y = 80k. Distribute 1.05M.
    const w = computeWaterfall(1_050_000, 1_000_000, DEFAULT_TERMS, 1);
    expect(w.tiers.find((t) => t.key === "roc")!.toLps).toBe(1_000_000);
    expect(w.tiers.find((t) => t.key === "pref")!.toLps).toBe(50_000); // only 50k left, all pref
    expect(w.totalToGp).toBe(0);
  });

  it("runs the full stack: roc, full pref, GP catch-up, then carry split", () => {
    // paid-in 1M, pref 80k, carry 20%, catch-up 100%. Distribute 2M.
    const w = computeWaterfall(2_000_000, 1_000_000, DEFAULT_TERMS, 1);
    const roc = w.tiers.find((t) => t.key === "roc")!;
    const pref = w.tiers.find((t) => t.key === "pref")!;
    const cu = w.tiers.find((t) => t.key === "catchup")!;
    const carry = w.tiers.find((t) => t.key === "carry")!;
    expect(roc.toLps).toBe(1_000_000);
    expect(pref.toLps).toBe(80_000);
    // catch-up target = 0.2/0.8 * 80k = 20k to GP
    expect(cu.toGp).toBe(20_000);
    // remaining = 2M - 1M - 80k - 20k = 900k → 20% carry to GP
    expect(carry.toGp).toBeCloseTo(180_000, 0);
    expect(carry.toLps).toBeCloseTo(720_000, 0);
    // GP total = 20k + 180k = 200k of 1M profit = 20%
    expect(w.totalToGp).toBeCloseTo(200_000, 0);
  });

  it("handles zero / negative distributions safely", () => {
    const w = computeWaterfall(0, 1_000_000);
    expect(w.totalToLps).toBe(0);
    expect(w.totalToGp).toBe(0);
    expect(w.lpPct).toBe(0);
  });
});

describe("allocateToHolders", () => {
  it("splits the LP portion by ownership share", () => {
    const out = allocateToHolders(1_000_000, [
      { name: "A", ownershipPct: 60 },
      { name: "B", ownershipPct: 40 },
    ]);
    expect(out[0].amount).toBe(600_000);
    expect(out[1].amount).toBe(400_000);
  });
});
