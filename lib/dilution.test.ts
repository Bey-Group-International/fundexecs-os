// lib/dilution.test.ts
import { modelRound } from "@/lib/dilution";

describe("modelRound", () => {
  it("basic dilution: founders diluted pro-rata, new investor added", () => {
    const res = modelRound(
      [
        { name: "Founder A", pct: 60 },
        { name: "Founder B", pct: 40 },
      ],
      { preMoney: 8_000_000, raiseAmount: 2_000_000 },
    );

    // 2M / 10M = 20% to the new investor.
    expect(res.postMoney).toBe(10_000_000);
    expect(res.newInvestorPct).toBe(20);
    expect(res.optionPoolPct).toBe(0);
    expect(res.dilutionFactor).toBeCloseTo(0.8, 10);

    const a = res.rows.find((r) => r.name === "Founder A")!;
    const b = res.rows.find((r) => r.name === "Founder B")!;
    const inv = res.rows.find((r) => r.name === "New Investor")!;

    expect(a.premPct).toBe(60);
    expect(a.postPct).toBe(48); // 60 * 0.8
    expect(a.deltaPct).toBe(-12);
    expect(b.postPct).toBe(32); // 40 * 0.8
    expect(b.deltaPct).toBe(-8);
    expect(inv.postPct).toBe(20);
    expect(inv.premPct).toBe(0);
    expect(inv.deltaPct).toBe(0);

    // Post % across all rows sums to 100.
    const sum = res.rows.reduce((s, r) => s + r.postPct, 0);
    expect(round2(sum)).toBe(100);
  });

  it("honours a custom new-investor name", () => {
    const res = modelRound([{ name: "Solo", pct: 100 }], {
      preMoney: 4_000_000,
      raiseAmount: 1_000_000,
      newInvestorName: "Acme Ventures",
    });
    expect(res.rows.some((r) => r.name === "Acme Ventures")).toBe(true);
    expect(res.rows.some((r) => r.name === "New Investor")).toBe(false);
  });

  it("with option pool: pool + investor both added, existing diluted by remaining", () => {
    const res = modelRound([{ name: "Founder", pct: 100 }], {
      preMoney: 9_000_000,
      raiseAmount: 1_000_000, // 10% to investor
      optionPoolPct: 10, // 10% post-money pool
    });

    expect(res.newInvestorPct).toBe(10);
    expect(res.optionPoolPct).toBe(10);
    // remaining = 100 - 10 - 10 = 80
    expect(res.dilutionFactor).toBeCloseTo(0.8, 10);

    const founder = res.rows.find((r) => r.name === "Founder")!;
    const pool = res.rows.find((r) => r.name === "Option Pool (new)")!;
    const inv = res.rows.find((r) => r.name === "New Investor")!;

    expect(founder.postPct).toBe(80);
    expect(founder.deltaPct).toBe(-20);
    expect(pool.postPct).toBe(10);
    expect(pool.premPct).toBe(0);
    expect(pool.deltaPct).toBe(0);
    expect(inv.postPct).toBe(10);

    const sum = res.rows.reduce((s, r) => s + r.postPct, 0);
    expect(round2(sum)).toBe(100);
  });

  it("does not add an option pool row when optionPoolPct is 0", () => {
    const res = modelRound([{ name: "Founder", pct: 100 }], {
      preMoney: 9_000_000,
      raiseAmount: 1_000_000,
      optionPoolPct: 0,
    });
    expect(res.rows.some((r) => r.name === "Option Pool (new)")).toBe(false);
  });

  it("empty cap table: only the new investor (and pool) appear", () => {
    const res = modelRound([], {
      preMoney: 5_000_000,
      raiseAmount: 5_000_000, // 50%
      optionPoolPct: 10,
    });
    expect(res.newInvestorPct).toBe(50);
    expect(res.rows).toHaveLength(2);
    expect(res.rows.find((r) => r.name === "New Investor")!.postPct).toBe(50);
    expect(res.rows.find((r) => r.name === "Option Pool (new)")!.postPct).toBe(10);
  });

  it("zero raise: no new investor, no dilution", () => {
    const res = modelRound(
      [
        { name: "A", pct: 70 },
        { name: "B", pct: 30 },
      ],
      { preMoney: 5_000_000, raiseAmount: 0 },
    );
    expect(res.newInvestorPct).toBe(0);
    expect(res.dilutionFactor).toBe(1);
    expect(res.rows).toHaveLength(2);
    expect(res.rows.find((r) => r.name === "A")!.postPct).toBe(70);
    expect(res.rows.find((r) => r.name === "A")!.deltaPct).toBe(0);
    expect(res.rows.find((r) => r.name === "B")!.postPct).toBe(30);
  });

  it("postMoney <= 0 yields zero new-investor pct (no division blowup)", () => {
    const res = modelRound([{ name: "A", pct: 100 }], {
      preMoney: 0,
      raiseAmount: 0,
    });
    expect(res.postMoney).toBe(0);
    expect(res.newInvestorPct).toBe(0);
    expect(res.dilutionFactor).toBe(1);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].postPct).toBe(100);
  });

  it("clamps an out-of-range option pool and keeps remaining >= 0", () => {
    const res = modelRound([{ name: "A", pct: 100 }], {
      preMoney: 1_000_000,
      raiseAmount: 9_000_000, // 90% to investor
      optionPoolPct: 50, // would push remaining negative -> clamp to 0
    });
    expect(res.newInvestorPct).toBe(90);
    expect(res.optionPoolPct).toBe(50);
    expect(res.dilutionFactor).toBe(0); // remaining clamped at 0
    expect(res.rows.find((r) => r.name === "A")!.postPct).toBe(0);
    expect(res.rows.find((r) => r.name === "A")!.deltaPct).toBe(-100);
  });

  it("handles non-finite/garbage inputs gracefully", () => {
    const res = modelRound([{ name: "A", pct: Number.NaN }], {
      preMoney: Number.NaN,
      raiseAmount: Number.POSITIVE_INFINITY,
      optionPoolPct: Number.NaN,
    });
    expect(Number.isFinite(res.postMoney)).toBe(true);
    expect(res.newInvestorPct).toBe(0);
    expect(res.optionPoolPct).toBe(0);
    expect(res.rows[0].premPct).toBe(0);
  });
});

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
