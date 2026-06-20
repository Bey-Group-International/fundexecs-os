// lib/underwriting-calc.test.ts
// Unit tests for the pure underwriting math. No DB — small in-memory fixtures.
// Floating-point comparisons use toBeCloseTo.
import {
  computeReturns,
  computeReturnsFromInputs,
  compareScenarios,
  weightedReturn,
  rollupEquityRequired,
  readProbability,
  readAssumptions,
  groupByDeal,
} from "@/lib/underwriting-calc";
import type { Underwriting } from "@/lib/supabase/database.types";

function makeUW(overrides: Partial<Underwriting> = {}): Underwriting {
  return {
    id: "uw-1",
    organization_id: "org-1",
    deal_id: "deal-1",
    name: "Base Case",
    scenario: "base",
    model: {},
    projected_irr: 0.2,
    projected_moic: 2.0,
    equity_required: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as Underwriting;
}

// --- computeReturns --------------------------------------------------------
describe("computeReturns", () => {
  it("computes MOIC and annualized IRR", () => {
    const { moic, irr } = computeReturns({ equity: 100, exitValue: 200, holdYears: 5 });
    expect(moic).toBeCloseTo(2.0, 6);
    // 2^(1/5) - 1 ≈ 0.148698
    expect(irr).toBeCloseTo(0.148698, 5);
  });

  it("returns IRR 0 when exit equals entry", () => {
    const { moic, irr } = computeReturns({ equity: 100, exitValue: 100, holdYears: 3 });
    expect(moic).toBeCloseTo(1.0, 6);
    expect(irr).toBeCloseTo(0, 6);
  });

  it("handles negative IRR on a loss", () => {
    const { moic, irr } = computeReturns({ equity: 100, exitValue: 50, holdYears: 2 });
    expect(moic).toBeCloseTo(0.5, 6);
    // 0.5^(1/2) - 1 ≈ -0.292893
    expect(irr).toBeCloseTo(-0.292893, 5);
  });

  it("returns nulls for degenerate inputs", () => {
    expect(computeReturns({ equity: 0, exitValue: 100, holdYears: 5 })).toEqual({
      moic: null,
      irr: null,
    });
    expect(computeReturns({ equity: -10, exitValue: 100, holdYears: 5 }).moic).toBeNull();
  });

  it("returns null IRR (but a MOIC) when holdYears is zero", () => {
    const { moic, irr } = computeReturns({ equity: 100, exitValue: 250, holdYears: 0 });
    expect(moic).toBeCloseTo(2.5, 6);
    expect(irr).toBeNull();
  });
});

describe("computeReturnsFromInputs", () => {
  it("derives exit value from an exit multiple", () => {
    const { moic, irr } = computeReturnsFromInputs({ equity: 100, exitMultiple: 3, holdYears: 6 });
    expect(moic).toBeCloseTo(3.0, 6);
    expect(irr).toBeCloseTo(Math.pow(3, 1 / 6) - 1, 6);
  });

  it("prefers explicit exit value over multiple", () => {
    const { moic } = computeReturnsFromInputs({
      equity: 100,
      exitValue: 400,
      exitMultiple: 2,
      holdYears: 4,
    });
    expect(moic).toBeCloseTo(4.0, 6);
  });
});

// --- compareScenarios + deltas ---------------------------------------------
describe("compareScenarios", () => {
  it("returns the four canonical rows and computes deltas vs base", () => {
    const cases = [
      makeUW({ id: "b", scenario: "base", projected_irr: 0.2, projected_moic: 2.0 }),
      makeUW({ id: "u", scenario: "upside", projected_irr: 0.3, projected_moic: 2.8 }),
      makeUW({ id: "d", scenario: "downside", projected_irr: 0.1, projected_moic: 1.4 }),
    ];
    const cmp = compareScenarios("deal-1", cases);
    expect(cmp.rows.map((r) => r.scenario)).toEqual(["base", "upside", "downside", "stress"]);
    expect(cmp.baseCase?.id).toBe("b");

    const base = cmp.rows.find((r) => r.scenario === "base")!;
    expect(base.irrDeltaPct).toBeNull(); // base has no delta vs itself
    expect(base.irrPct).toBeCloseTo(20, 6);

    const upside = cmp.rows.find((r) => r.scenario === "upside")!;
    // 30% - 20% = 10pp; 2.8 - 2.0 = 0.8x
    expect(upside.irrDeltaPct).toBeCloseTo(10, 6);
    expect(upside.moicDelta).toBeCloseTo(0.8, 6);

    const downside = cmp.rows.find((r) => r.scenario === "downside")!;
    expect(downside.irrDeltaPct).toBeCloseTo(-10, 6);
    expect(downside.moicDelta).toBeCloseTo(-0.6, 6);

    const stress = cmp.rows.find((r) => r.scenario === "stress")!;
    expect(stress.uw).toBeNull();
    expect(stress.irrPct).toBeNull();
    expect(stress.irrDeltaPct).toBeNull();
  });

  it("normalizes percent- vs fraction-stored IRR consistently", () => {
    const cases = [
      makeUW({ id: "b", scenario: "base", projected_irr: 18 }), // stored as whole percent
      makeUW({ id: "u", scenario: "upside", projected_irr: 0.28 }), // stored as fraction
    ];
    const cmp = compareScenarios("deal-1", cases);
    const upside = cmp.rows.find((r) => r.scenario === "upside")!;
    // 28% - 18% = 10pp
    expect(upside.irrDeltaPct).toBeCloseTo(10, 6);
  });

  it("only considers cases for the requested deal", () => {
    const cases = [
      makeUW({ id: "b", deal_id: "deal-1", scenario: "base" }),
      makeUW({ id: "x", deal_id: "deal-2", scenario: "upside" }),
    ];
    const cmp = compareScenarios("deal-1", cases);
    expect(cmp.rows.find((r) => r.scenario === "upside")!.uw).toBeNull();
  });
});

// --- weightedReturn ---------------------------------------------------------
describe("weightedReturn", () => {
  it("normalizes weights that do not sum to 1", () => {
    // weights 2 and 2 (sum 4) → each 0.5; IRR fractions 0.1 and 0.3 → 10% & 30%
    const res = weightedReturn([
      { weight: 2, projected_irr: 0.1, projected_moic: 1.0 },
      { weight: 2, projected_irr: 0.3, projected_moic: 3.0 },
    ]);
    expect(res.irrPct).toBeCloseTo(20, 6);
    expect(res.moic).toBeCloseTo(2.0, 6);
    expect(res.totalWeight).toBeCloseTo(4, 6);
    expect(res.contributing).toBe(2);
  });

  it("weights asymmetrically", () => {
    // 0.75 @ 20% + 0.25 @ 40% = 25%
    const res = weightedReturn([
      { weight: 0.75, projected_irr: 0.2, projected_moic: 2.0 },
      { weight: 0.25, projected_irr: 0.4, projected_moic: 4.0 },
    ]);
    expect(res.irrPct).toBeCloseTo(25, 6);
    expect(res.moic).toBeCloseTo(2.5, 6);
  });

  it("normalizes each metric independently when a case misses one", () => {
    // Case 2 has no MOIC, so MOIC normalizes over case 1 alone.
    const res = weightedReturn([
      { weight: 1, projected_irr: 0.2, projected_moic: 2.0 },
      { weight: 1, projected_irr: 0.4, projected_moic: null },
    ]);
    expect(res.irrPct).toBeCloseTo(30, 6); // (20+40)/2
    expect(res.moic).toBeCloseTo(2.0, 6); // only case 1 contributes
  });

  it("returns nulls when all weights are zero or no values exist", () => {
    expect(weightedReturn([{ weight: 0, projected_irr: 0.2, projected_moic: 2 }]).irrPct).toBeNull();
    expect(weightedReturn([]).moic).toBeNull();
  });
});

// --- rollupEquityRequired ---------------------------------------------------
describe("rollupEquityRequired", () => {
  it("sums base-case equity across deals", () => {
    const cases = [
      makeUW({ id: "1", deal_id: "deal-1", scenario: "base", equity_required: 1000 }),
      makeUW({ id: "2", deal_id: "deal-1", scenario: "upside", equity_required: 9999 }), // ignored
      makeUW({ id: "3", deal_id: "deal-2", scenario: "base", equity_required: 500 }),
      makeUW({ id: "4", deal_id: "deal-3", scenario: "base", equity_required: null }), // skipped
    ];
    const roll = rollupEquityRequired(cases);
    expect(roll.totalEquityRequired).toBeCloseTo(1500, 6);
    expect(roll.dealsWithEquity).toBe(2);
    expect(roll.byDeal).toHaveLength(2);
  });

  it("falls back to the first case when no explicit base scenario exists", () => {
    const cases = [
      makeUW({ id: "1", deal_id: "deal-1", scenario: "upside", equity_required: 700 }),
    ];
    const roll = rollupEquityRequired(cases);
    expect(roll.totalEquityRequired).toBeCloseTo(700, 6);
  });

  it("returns zero for an empty pipeline", () => {
    expect(rollupEquityRequired([])).toEqual({
      totalEquityRequired: 0,
      dealsWithEquity: 0,
      byDeal: [],
    });
  });
});

// --- model JSON readers -----------------------------------------------------
describe("model readers", () => {
  it("reads and clamps probability", () => {
    expect(readProbability({ probability: 0.4 })).toBeCloseTo(0.4, 6);
    expect(readProbability({ probability: 1.5 })).toBe(1);
    expect(readProbability({ probability: -1 })).toBe(0);
    expect(readProbability({})).toBeNull();
    expect(readProbability(null)).toBeNull();
    expect(readProbability("nope")).toBeNull();
  });

  it("reads assumptions defensively", () => {
    const a = readAssumptions({ assumptions: { equity: 100, holdYears: 5, exitMultiple: 2 } });
    expect(a.equity).toBe(100);
    expect(a.holdYears).toBe(5);
    expect(a.exitMultiple).toBe(2);
    expect(a.exitValue).toBeNull();
    expect(readAssumptions(null).equity).toBeNull();
  });
});

describe("groupByDeal", () => {
  it("groups cases by deal id", () => {
    const map = groupByDeal([
      makeUW({ id: "1", deal_id: "deal-1" }),
      makeUW({ id: "2", deal_id: "deal-2" }),
      makeUW({ id: "3", deal_id: "deal-1" }),
    ]);
    expect(map.get("deal-1")).toHaveLength(2);
    expect(map.get("deal-2")).toHaveLength(1);
  });
});
