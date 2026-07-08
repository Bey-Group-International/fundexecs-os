// lib/earn/lp-sim.test.ts
// Unit tests for the constant-product LP simulator. Pure math — no I/O.
import {
  poolFromReserves,
  spotPrice,
  swap,
  impermanentLoss,
  feeApr,
  lpEdgeVsHold,
} from "@/lib/earn/lp-sim";

describe("poolFromReserves / spotPrice", () => {
  it("computes the invariant and price", () => {
    const p = poolFromReserves(100, 200);
    expect(p.k).toBe(20000);
    expect(p.price).toBe(2); // 200 Y per 100 X
  });

  it("zeroes an inert pool for non-positive reserves", () => {
    expect(poolFromReserves(0, 200).price).toBe(0);
    expect(spotPrice(0, 5)).toBe(0);
  });
});

describe("swap", () => {
  it("follows the constant-product formula with a fee", () => {
    const pool = poolFromReserves(1000, 1000);
    const q = swap(pool, 100, { feeBps: 30 });
    // amountInAfterFee = 99.7; out = 1000*99.7/(1000+99.7) ≈ 90.66
    expect(q.feePaid).toBeCloseTo(0.3, 6);
    expect(q.amountOut).toBeCloseTo(90.6612, 3);
  });

  it("roughly preserves the invariant (k grows only by fees)", () => {
    const pool = poolFromReserves(1000, 1000);
    const q = swap(pool, 100, { feeBps: 30 });
    // k must not shrink — fees make the post-trade product ≥ the original.
    expect(q.poolAfter.k).toBeGreaterThanOrEqual(pool.k - 1e-6);
  });

  it("larger trades incur larger price impact", () => {
    const pool = poolFromReserves(1000, 1000);
    const small = swap(pool, 10, { feeBps: 0 });
    const big = swap(pool, 500, { feeBps: 0 });
    expect(big.priceImpact).toBeGreaterThan(small.priceImpact);
    expect(small.priceImpact).toBeGreaterThan(0);
  });

  it("returns a zeroed quote for non-positive input", () => {
    const pool = poolFromReserves(1000, 1000);
    expect(swap(pool, 0).amountOut).toBe(0);
    expect(swap(pool, -5).amountOut).toBe(0);
  });

  it("can swap the Y side into X", () => {
    const pool = poolFromReserves(1000, 2000);
    const q = swap(pool, 200, { feeBps: 0, xIsInput: false });
    expect(q.amountOut).toBeGreaterThan(0);
    // Output is X; pool X should fall, Y should rise.
    expect(q.poolAfter.x).toBeLessThan(pool.x);
    expect(q.poolAfter.y).toBeGreaterThan(pool.y);
  });
});

describe("impermanentLoss", () => {
  it("is zero when price is unchanged", () => {
    expect(impermanentLoss(1)).toBe(0);
  });

  it("matches the known ~5.7% loss at a 2x move", () => {
    expect(impermanentLoss(2)).toBeCloseTo(0.0572, 4);
  });

  it("is symmetric in r and 1/r", () => {
    expect(impermanentLoss(4)).toBeCloseTo(impermanentLoss(0.25), 10);
  });

  it("grows with larger moves", () => {
    expect(impermanentLoss(10)).toBeGreaterThan(impermanentLoss(2));
  });
});

describe("feeApr", () => {
  it("annualizes daily fee revenue over liquidity", () => {
    // 1,000,000 daily volume at 30bps over 10,000,000 liquidity = 0.03%/day.
    const apr = feeApr({ dailyVolume: 1_000_000, liquidity: 10_000_000, feeBps: 30 });
    expect(apr).toBeCloseTo(((1_000_000 * 0.003) / 10_000_000) * 365, 8);
  });

  it("returns 0 for an empty pool", () => {
    expect(feeApr({ dailyVolume: 1000, liquidity: 0 })).toBe(0);
  });
});

describe("lpEdgeVsHold", () => {
  it("is positive when fees outrun impermanent loss", () => {
    // 20% APR over a full year vs a mild 1.1x move.
    const edge = lpEdgeVsHold({ priceRatio: 1.1, feeApr: 0.2, days: 365 });
    expect(edge).toBeGreaterThan(0);
  });

  it("is negative when a big move's IL dwarfs thin fees", () => {
    const edge = lpEdgeVsHold({ priceRatio: 4, feeApr: 0.01, days: 30 });
    expect(edge).toBeLessThan(0);
  });
});
