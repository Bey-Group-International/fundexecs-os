// lib/secondaries.test.ts — pure secondary-transfer math, no I/O.
import { modelTransfer, priceFromNav, type Position } from "@/lib/secondaries";

const position: Position = { committed: 1_000_000, called: 600_000, distributed: 150_000 };

describe("priceFromNav", () => {
  it("prices a stake as a percentage of its NAV share", () => {
    expect(priceFromNav(500_000, 92)).toBe(460_000); // 8% discount
  });
});

describe("modelTransfer", () => {
  it("transfers a fraction of every leg of the position", () => {
    const t = modelTransfer(position, 800_000, 0.5, 368_000);
    expect(t.committed).toBe(500_000);
    expect(t.called).toBe(300_000);
    expect(t.distributed).toBe(75_000);
    expect(t.unfunded).toBe(200_000); // (1M − 600k) × 0.5
    expect(t.navShareTransferred).toBe(400_000);
  });

  it("computes the premium/discount to NAV", () => {
    const t = modelTransfer(position, 800_000, 0.5, 368_000);
    // price 368k vs NAV share 400k → −8%
    expect(t.premiumDiscountPct).toBeCloseTo(-8, 1);
  });

  it("leaves the seller with the complementary position", () => {
    const t = modelTransfer(position, 800_000, 0.25, 100_000);
    expect(t.sellerRemaining.committed).toBe(750_000);
    expect(t.sellerRemaining.called).toBe(450_000);
    expect(t.sellerRemaining.distributed).toBe(112_500);
  });

  it("clamps an over-100% fraction to the whole position", () => {
    const t = modelTransfer(position, 800_000, 1.5, 800_000);
    expect(t.fraction).toBe(1);
    expect(t.committed).toBe(1_000_000);
    expect(t.sellerRemaining.committed).toBe(0);
  });
});
