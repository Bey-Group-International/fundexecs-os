import {
  computeWaterfallSchedule,
  splitResidualTiered,
  DEFAULT_SCHEDULE_TERMS,
  type ScheduleTerms,
  type CashflowEvent,
} from "./waterfall-schedule";

describe("splitResidualTiered", () => {
  it("splits by a single carry rate when there is one infinite tier", () => {
    const r = splitResidualTiered(100, 0, 100, [{ carry: 0.2, upToMultiple: Infinity }]);
    expect(r.gp).toBeCloseTo(20, 6);
    expect(r.lp).toBeCloseTo(80, 6);
  });

  it("steps up to super-carry once LPs pass the tier multiple", () => {
    // paidIn 100; LPs have already received 200 (2x). First tier caps at 2x, so
    // the whole residual falls in the 30% tier.
    const tiers = [
      { carry: 0.2, upToMultiple: 2 },
      { carry: 0.3, upToMultiple: Infinity },
    ];
    const r = splitResidualTiered(100, 200, 100, tiers);
    expect(r.gp).toBeCloseTo(30, 6);
    expect(r.lp).toBeCloseTo(70, 6);
  });

  it("crosses a tier boundary mid-residual", () => {
    // paidIn 100, LPs at 180 (1.8x). Tier1 20% up to 2x → LP room to 2x = 20.
    // Fill 20 of LP at 20% carry needs residual 20/0.8 = 25 (gp 5). Remaining
    // residual splits at 30%.
    const tiers = [
      { carry: 0.2, upToMultiple: 2 },
      { carry: 0.3, upToMultiple: Infinity },
    ];
    const r = splitResidualTiered(125, 180, 100, tiers);
    // First 25 residual: lp 20, gp 5. Remaining 100: lp 70, gp 30.
    expect(r.lp).toBeCloseTo(90, 6);
    expect(r.gp).toBeCloseTo(35, 6);
  });
});

describe("computeWaterfallSchedule", () => {
  const single: CashflowEvent[] = [
    { period: 0, contribution: 100 },
    { period: 1, distribution: 150 },
  ];

  it("conserves cash: LP + GP splits sum to the amount distributed", () => {
    const r = computeWaterfallSchedule(single);
    expect(r.totalToLps + r.totalToGp).toBeCloseTo(r.totalDistributed, 6);
    expect(r.totalDistributed).toBe(150);
  });

  it("returns capital first, then pref, before any GP share", () => {
    // 100 paid in, 8% pref over 1 yr = 8. Distribute 150: ROC 100, pref 8,
    // leaving 42 for catch-up + carry.
    const r = computeWaterfallSchedule(single);
    const d = r.distributions[0];
    expect(d.roc).toBeCloseTo(100, 6);
    expect(d.prefToLps).toBeCloseTo(8, 6);
    expect(d.roc + d.prefToLps + d.catchUpToGp + d.carryToLps + d.carryToGp).toBeCloseTo(150, 6);
  });

  it("a distribution below unreturned capital is pure return of capital", () => {
    const r = computeWaterfallSchedule([
      { period: 0, contribution: 100 },
      { period: 1, distribution: 60 },
    ]);
    const d = r.distributions[0];
    expect(d.roc).toBeCloseTo(60, 6);
    expect(d.toGp).toBeCloseTo(0, 6);
    expect(r.unreturnedCapital).toBeCloseTo(40, 6);
  });

  it("compounding pref accrues more than simple pref over multiple years", () => {
    const events: CashflowEvent[] = [
      { period: 0, contribution: 100 },
      { period: 5, distribution: 100 }, // only enough to test pref accrual size
    ];
    const compTerms: ScheduleTerms = { ...DEFAULT_SCHEDULE_TERMS, compounding: true };
    const simpleTerms: ScheduleTerms = { ...DEFAULT_SCHEDULE_TERMS, compounding: false };
    const comp = computeWaterfallSchedule(events, compTerms);
    const simple = computeWaterfallSchedule(events, simpleTerms);
    // After ROC (100), the remaining 0 leaves accrued pref on the books; the
    // compounding run should carry a larger accrued-pref balance.
    expect(comp.accruedPrefRemaining).toBeGreaterThan(simple.accruedPrefRemaining);
    // Simple: 100 * 0.08 * 5 = 40.
    expect(simple.accruedPrefRemaining).toBeCloseTo(40, 6);
    // Compound: 100 * (1.08^5 - 1) ≈ 46.93.
    expect(comp.accruedPrefRemaining).toBeCloseTo(100 * (Math.pow(1.08, 5) - 1), 4);
  });

  it("accumulates ROC and pref across multiple distributions", () => {
    const r = computeWaterfallSchedule([
      { period: 0, contribution: 100 },
      { period: 1, distribution: 50 }, // ROC 50 (unreturned 50 left)
      { period: 2, distribution: 200 }, // ROC 50, then pref, then profit split
    ]);
    expect(r.distributions[0].roc).toBeCloseTo(50, 6);
    expect(r.distributions[1].roc).toBeCloseTo(50, 6);
    expect(r.unreturnedCapital).toBeCloseTo(0, 6);
    expect(r.totalToLps + r.totalToGp).toBeCloseTo(250, 6);
  });

  it("reports DPI and LP/GP split shares", () => {
    const r = computeWaterfallSchedule(single);
    expect(r.dpi).toBeCloseTo(r.totalToLps / 100, 2);
    expect(r.lpPct + r.gpPct).toBeCloseTo(100, 1);
    expect(r.gpPct).toBeGreaterThan(0);
  });

  it("gives the GP a larger share under super-carry than a flat carry", () => {
    const events: CashflowEvent[] = [
      { period: 0, contribution: 100 },
      { period: 1, distribution: 400 }, // large realization, LPs well past 2x
    ];
    const flat: ScheduleTerms = {
      ...DEFAULT_SCHEDULE_TERMS,
      carryTiers: [{ carry: 0.2, upToMultiple: Infinity }],
    };
    const tiered: ScheduleTerms = {
      ...DEFAULT_SCHEDULE_TERMS,
      carryTiers: [
        { carry: 0.2, upToMultiple: 2 },
        { carry: 0.3, upToMultiple: Infinity },
      ],
    };
    const rFlat = computeWaterfallSchedule(events, flat);
    const rTiered = computeWaterfallSchedule(events, tiered);
    expect(rTiered.totalToGp).toBeGreaterThan(rFlat.totalToGp);
  });

  it("handles an empty schedule", () => {
    const r = computeWaterfallSchedule([]);
    expect(r.paidIn).toBe(0);
    expect(r.totalToLps).toBe(0);
    expect(r.distributions).toHaveLength(0);
  });
});
