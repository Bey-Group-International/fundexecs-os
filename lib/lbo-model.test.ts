import { computeLbo, defaultLboInputs, type LboInputs } from "./lbo-model";

describe("computeLbo — structure", () => {
  it("splits entry EV into debt and equity from the multiple and debt share", () => {
    const r = computeLbo(defaultLboInputs());
    expect(r.entryEV).toBe(200_000_000); // 5.0x * 40M
    expect(r.entryDebt).toBeCloseTo(120_000_000, 0); // 60%
    expect(r.entryEquity).toBeCloseTo(80_000_000, 0); // 40%
  });

  it("grows exit EBITDA at the revenue growth rate over the hold", () => {
    const r = computeLbo(defaultLboInputs());
    // 40M entry EBITDA * 1.1^5
    expect(r.exitEbitda).toBeCloseTo(40_000_000 * Math.pow(1.1, 5), 0);
    expect(r.exitEV).toBeCloseTo(5 * r.exitEbitda, 0);
  });

  it("produces one schedule row per hold year with a monotonically non-increasing debt balance", () => {
    const r = computeLbo(defaultLboInputs());
    expect(r.schedule).toHaveLength(5);
    let prev = r.entryDebt;
    for (const y of r.schedule) {
      expect(y.endingDebt).toBeLessThanOrEqual(prev + 1e-6);
      expect(y.endingDebt).toBeGreaterThanOrEqual(0);
      prev = y.endingDebt;
    }
    expect(r.endingDebt).toBeCloseTo(r.schedule[r.schedule.length - 1].endingDebt, 6);
  });

  it("defines exit equity as exit EV minus remaining debt", () => {
    const r = computeLbo(defaultLboInputs());
    expect(r.exitEquity).toBeCloseTo(r.exitEV - r.endingDebt, 0);
  });
});

describe("computeLbo — returns", () => {
  it("lands the classic mid-market case in a sane MOIC/IRR range", () => {
    const r = computeLbo(defaultLboInputs());
    expect(r.moic).not.toBeNull();
    expect(r.irr).not.toBeNull();
    expect(r.moic!).toBeGreaterThan(2.5);
    expect(r.moic!).toBeLessThan(3.6);
    expect(r.irr!).toBeGreaterThan(0.18);
    expect(r.irr!).toBeLessThan(0.32);
  });

  it("MOIC is exit equity over entry equity, and IRR is its CAGR over the hold", () => {
    const r = computeLbo(defaultLboInputs());
    expect(r.moic!).toBeCloseTo(r.exitEquity / r.entryEquity, 6);
    expect(r.irr!).toBeCloseTo(Math.pow(r.moic!, 1 / 5) - 1, 6);
  });

  it("more leverage amplifies equity returns (all else equal)", () => {
    const low = computeLbo({ ...defaultLboInputs(), debtPct: 0.3 });
    const high = computeLbo({ ...defaultLboInputs(), debtPct: 0.7 });
    expect(high.moic!).toBeGreaterThan(low.moic!);
  });

  it("multiple expansion lifts returns; contraction lowers them", () => {
    const flat = computeLbo(defaultLboInputs());
    const up = computeLbo({ ...defaultLboInputs(), exitMultiple: 6 });
    const down = computeLbo({ ...defaultLboInputs(), exitMultiple: 4 });
    expect(up.moic!).toBeGreaterThan(flat.moic!);
    expect(down.moic!).toBeLessThan(flat.moic!);
  });
});

describe("computeLbo — value bridge", () => {
  it("the three drivers sum exactly to equity value created", () => {
    const r = computeLbo(defaultLboInputs());
    const created = r.exitEquity - r.entryEquity;
    const sum = r.bridge.ebitdaGrowth + r.bridge.multipleExpansion + r.bridge.debtPaydown;
    expect(sum).toBeCloseTo(created, 0);
  });

  it("with a flat multiple, no value comes from multiple expansion", () => {
    const r = computeLbo(defaultLboInputs()); // entry 5x == exit 5x
    expect(r.bridge.multipleExpansion).toBeCloseTo(0, 6);
  });

  it("attributes deleveraging to the debt-paydown driver", () => {
    const r = computeLbo(defaultLboInputs());
    expect(r.bridge.debtPaydown).toBeCloseTo(r.entryDebt - r.endingDebt, 6);
    expect(r.bridge.debtPaydown).toBeGreaterThan(0);
  });
});

describe("computeLbo — guards", () => {
  it("returns null MOIC/IRR and an empty schedule for degenerate inputs", () => {
    const bad: LboInputs = { ...defaultLboInputs(), entryEbitda: 0 };
    const r = computeLbo(bad);
    expect(r.moic).toBeNull();
    expect(r.irr).toBeNull();
    expect(r.schedule).toHaveLength(0);
  });

  it("rejects a debt share of 100% (no equity to invest)", () => {
    const r = computeLbo({ ...defaultLboInputs(), debtPct: 1 });
    expect(r.moic).toBeNull();
  });

  it("floors the hold period and never returns negative equity", () => {
    const r = computeLbo({ ...defaultLboInputs(), holdYears: 3.9 });
    expect(r.schedule).toHaveLength(3);
    expect(r.exitEquity).toBeGreaterThanOrEqual(0);
  });
});
