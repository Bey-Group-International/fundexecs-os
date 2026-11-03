// Golden tests for the PE-department execution + portfolio skills.
import { covenantWatch } from "./covenant-watch";
import { kpiVariance } from "./kpi-variance";
import { cash13Week } from "./cash-13-week";
import { financingTerms } from "./financing-terms";
import { validate } from "@/lib/skills/validate";
import { parseFinancingPolicy } from "@/lib/pe/financing-policy";
import { parseKpiPolicy } from "@/lib/pe/kpi-policy";
import { resolveRootFiles } from "@/lib/pe/root-files";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "portfolio_ops" };

describe("covenant-watch", () => {
  const input = {
    company: "Acme",
    covenants: [
      { id: "lev", name: "Net leverage", clause: "CA cl. 22.2: Net Debt / Covenant EBITDA <= 4.50x", metric: "netLeverage" as const, kind: "max" as const, threshold: 4.5 },
      { id: "icr", name: "Interest cover", clause: "CA cl. 22.3", metric: "interestCover" as const, kind: "min" as const, threshold: 3 },
      { id: "nc", name: "Unquoted", clause: "", metric: "netLeverage" as const, kind: "max" as const, threshold: 4 },
    ],
    periods: [
      { label: "Q3", ebitda: 10, addbacks: [{ label: "Restructuring", amount: 1, clause: "cl. 1.1(c)" }, { label: "Synergies", amount: 2 }], netDebt: 40, interest: 3 },
      { label: "Q4F", forecast: true, ebitda: 9, netDebt: 40, interest: 3 },
    ],
    cureOptions: ["cl. 24: equity cure, max 2 in life"],
  };

  it("uses only permitted addbacks, computes headroom, and warns / breaches on the threshold", () => {
    const r = covenantWatch.run(input, ctx);
    const lev = r.structured.covenants.find((c) => c.id === "lev")!;
    // Q3 covenant EBITDA = 10 + 1 (permitted) = 11 ; 40/11 = 3.64 ; headroom (4.5-3.64)/4.5 = 19.2% -> warning (<20 default)
    expect(lev.periods[0].covenantEbitda).toBe(11);
    expect(lev.periods[0].ratio).toBe(3.64);
    expect(lev.periods[0].status).toBe("warning");
    // Q4F: 40/9 = 4.44 -> headroom 1.2% -> warning; tightest is the forecast
    expect(lev.tightest?.period).toBe("Q4F");
    expect(r.structured.excludedAddbacks).toEqual([{ period: "Q3", label: "Synergies", amount: 2, reason: expect.stringMatching(/No clause cited/) }]);
    const icr = r.structured.covenants.find((c) => c.id === "icr")!;
    expect(icr.periods[0].ratio).toBe(3.67); // 11/3
    expect(icr.periods[0].status).toBe("ok");
    expect(r.structured.warnThresholdIsDefault).toBe(true);
    expect(validate(r.structured, covenantWatch.manifest.outputSchema).valid).toBe(true);
  });

  it("does not calculate a covenant that quotes no clause, and detects a breach", () => {
    const r = covenantWatch.run({ ...input, periods: [{ label: "Q4", ebitda: 8, netDebt: 40, interest: 3 }] }, ctx);
    expect(r.structured.covenants.find((c) => c.id === "nc")!.periods[0].status).toBe("not-calculated");
    expect(r.structured.covenants.find((c) => c.id === "lev")!.periods[0].status).toBe("breach"); // 5.0x > 4.5x
    expect(r.missingData.join(" ")).toMatch(/quotes no agreement clause/);
  });

  it("honours the org's warning threshold and escalation", () => {
    const r = covenantWatch.run({ ...input, financing: { covenantWarnHeadroomPct: 10, escalateBelowPct: 5, escalateTo: "CFO" } }, ctx);
    const lev = r.structured.covenants.find((c) => c.id === "lev")!;
    expect(lev.periods[0].status).toBe("ok"); // 19.2% >= 10
    expect(lev.escalate).toBe(true); // 1.2% < 5
    expect(r.structured.warnThresholdIsDefault).toBe(false);
  });
});

describe("kpi-variance", () => {
  const input = {
    company: "Acme",
    period: "Mar",
    kpis: [
      { name: "Revenue", actual: 92, budget: 100, priorYear: 90, drivers: [{ name: "Volume", amount: -5 }, { name: "Price", amount: -3 }], classification: "timing" as const },
      { name: "COGS", higherIsBetter: false, actual: 63, budget: 60, series: [58, 59, 61, 63], classification: "one-off" as const, evidence: "Supplier invoice 441" },
      { name: "Headcount", actual: 101, budget: 100 },
    ],
  };

  it("applies materiality, reads direction, ties drivers, and challenges unevidenced classifications", () => {
    const r = kpiVariance.run(input, ctx);
    const rev = r.structured.rows.find((x) => x.name === "Revenue")!;
    expect(rev.variancePct).toBe(-8);
    expect(rev.direction).toBe("adverse");
    expect(rev.material).toBe(true);
    expect(rev.drivers).toEqual({ sum: -8, unexplained: 0, ties: true });
    expect(rev.challenges.join(" ")).toMatch(/management's word only/);
    const cogs = r.structured.rows.find((x) => x.name === "COGS")!;
    expect(cogs.direction).toBe("adverse"); // cost up = adverse
    expect(cogs.material).toBe(true); // exactly 5.0% meets the "at or above 5%" test
  });

  it("flags a 'one-off' call that the series contradicts, when the firm sets a trend test", () => {
    const r = kpiVariance.run({ ...input, kpiPolicy: { materialityPct: 5, trendPeriods: 3 } }, ctx);
    const cogs = r.structured.rows.find((x) => x.name === "COGS")!;
    expect(cogs.computedTrend).toBe(true);
    expect(cogs.challenges.join(" ")).toMatch(/Called one-off, but the series shows an adverse trend/);
    expect(r.structured.policyIsDefault).toBe(false);
  });

  it("requires the absolute floor too when the firm sets one, and reports a driver residual", () => {
    const r = kpiVariance.run({ ...input, kpiPolicy: { materialityPct: 5, materialityAbs: 10 }, kpis: [{ name: "Revenue", actual: 92, budget: 100, drivers: [{ name: "Volume", amount: -5 }] }] }, ctx);
    expect(r.structured.rows[0].material).toBe(false); // 8 < 10
    const r2 = kpiVariance.run({ ...input, kpis: [{ name: "Revenue", actual: 92, budget: 100, drivers: [{ name: "Volume", amount: -5 }] }] }, ctx);
    expect(r2.structured.rows[0].drivers).toEqual({ sum: -5, unexplained: -3, ties: false });
    expect(validate(r2.structured, kpiVariance.manifest.outputSchema).valid).toBe(true);
  });
});

describe("cash-13-week", () => {
  const weeks = Array.from({ length: 13 }, (_, i) => ({ receipts: 100, payments: i === 5 ? 260 : 90, debtService: i === 8 ? 50 : 0 }));

  it("rolls weekly cash, finds the minimum, and sizes the facility draw against the minimum", () => {
    const r = cash13Week.run({ company: "Acme", openingCash: 50, openingTiedToBank: true, weeks, facilityAvailable: 30, financing: { covenantWarnHeadroomPct: 20, liquidityMinimum: 40 } }, ctx);
    const b = r.structured.base;
    expect(b.rows[0].closing).toBe(60);
    expect(b.rows[4].closing).toBe(100); // weeks 1-5: +10 each
    expect(b.rows[5].closing).toBe(-60); // week 6: -160
    expect(b.rows[8].closing).toBe(-80); // wk7 -50, wk8 -40, wk9 -80 after 50 debt service
    expect(b.minWeek).toBe(9);
    expect(b.minClosing).toBe(-80);
    expect(b.weeksBelowMinimum).toEqual([6, 7, 8, 9, 10, 11, 12, 13].filter((w) => b.rows[w - 1].closing < 40));
    expect(b.weeksBelowMinimum).toContain(6);
    expect(b.facilityDrawNeeded).toBe(120); // 40 - (-80)
    expect(b.breachesFacility).toBe(true);
    expect(r.structured.downside).toBeNull();
    expect(validate(r.structured, cash13Week.manifest.outputSchema).valid).toBe(true);
  });

  it("never invents a downside haircut; shows one only when supplied; builds the accuracy log", () => {
    const thin = cash13Week.run({ company: "Acme", openingCash: 50, weeks, thinCollectionHistory: true }, ctx);
    expect(thin.structured.downside).toBeNull();
    expect(thin.missingData.join(" ")).toMatch(/no downside receipts haircut/);
    expect(thin.missingData.join(" ")).toMatch(/not tied to the bank statements/);
    const dn = cash13Week.run({ company: "Acme", openingCash: 50, weeks, downsideReceiptsHaircutPct: 20, priorForecastClosing: [60, 70], actualClosing: [55, 70] }, ctx);
    expect(dn.structured.downside!.minClosing).toBeLessThan(dn.structured.base.minClosing);
    expect(dn.structured.accuracy).toEqual([
      { week: 1, forecast: 60, actual: 55, variance: -5, variancePct: -8.33 },
      { week: 2, forecast: 70, actual: 70, variance: 0, variancePct: 0 },
    ]);
  });
});

describe("financing-terms", () => {
  const offers = [
    { lender: "Bank A", seniorLeverage: 3.5, marginBps: 450, upfrontFeePct: 2, tenorYears: 7, amortPctPerYear: 1, covenant: "cov-lite" as const, callProtectionMonths: 6, equityCure: true, sourceRef: "TS A p.4" },
    { lender: "Unitranche B", seniorLeverage: 4.5, marginBps: 375, upfrontFeePct: 3, tenorYears: 6, amortPctPerYear: 0, covenant: "maintenance" as const, covenantHeadroomPct: 12, callProtectionMonths: 24, equityCure: false, sourceRef: "TS B p.2" },
    { lender: "Fund C", seniorLeverage: 3, marginBps: 600, upfrontFeePct: 1, tenorYears: 5, amortPctPerYear: 8, covenant: "maintenance" as const, covenantHeadroomPct: 30, callProtectionMonths: 12, equityCure: true },
  ];

  it("normalises to all-in cost, ranks cost and flexibility separately, and flags policy and downside terms", () => {
    const r = financingTerms.run({ baseRatePct: 4, offers }, ctx);
    const by = Object.fromEntries(r.structured.rows.map((x) => [x.lender, x]));
    expect(by["Bank A"].allInCostPct).toBe(8.79); // 4 + 4.5 + 2/7
    expect(by["Unitranche B"].allInCostPct).toBe(8.25); // 4 + 3.75 + 3/6
    expect(by["Unitranche B"].costRank).toBe(1);
    expect(by["Bank A"].flexibilityRank).toBe(1);
    expect(by["Unitranche B"].policyFlags.join(" ")).toMatch(/exceeds the 4x limit/);
    expect(by["Unitranche B"].downsideFlags.join(" ")).toMatch(/under the 20% warning level/);
    expect(by["Unitranche B"].downsideFlags.join(" ")).toMatch(/no equity cure/);
    expect(by["Fund C"].downsideFlags.join(" ")).toMatch(/Amortisation 8%/);
    expect(by["Fund C"].cited).toBe(false);
    expect(r.missingData.join(" ")).toMatch(/Fund C: no term-sheet page cited/);
    expect(r.structured.costMethod).toMatch(/upfront fee/);
    expect(r.structured.policyIsDefault).toBe(true);
    expect(validate(r.structured, financingTerms.manifest.outputSchema).valid).toBe(true);
  });
});

describe("financing / kpi policy parsing + root file resolution", () => {
  it("parses defensively and resolves org settings vs defaults", () => {
    expect(parseFinancingPolicy("x")).toBeNull();
    expect(parseFinancingPolicy({ covenantWarnHeadroomPct: -3 })).toBeNull();
    expect(parseFinancingPolicy({ maxSeniorLeverage: 4.5, liquidityMinimum: 2, covenantWarnHeadroomPct: 15 })?.covenantWarnHeadroomPct).toBe(15);
    expect(parseKpiPolicy({ materialityPct: 3, trendPeriods: 2.7 })).toEqual({ materialityPct: 3, materialityAbs: undefined, trendPeriods: 2 });
    const none = resolveRootFiles([]);
    expect(none.financingIsDefault && none.kpiIsDefault).toBe(true);
    expect(none.financing.maxSeniorLeverage).toBe(4);
    const some = resolveRootFiles([{ file_key: "financing", content: { liquidityMinimum: 5 } }, { file_key: "kpi", content: { materialityPct: 3 } }]);
    expect(some.found).toEqual(["kpi", "financing"]);
    expect(some.financing.liquidityMinimum).toBe(5);
    expect(some.kpiIsDefault).toBe(false);
  });
});
