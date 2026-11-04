// Golden tests for the debt-structure deterministic core. Numbers are worked by hand:
//   Senior TLB 3.0x of 20 = 60 @ 4% base + 450bps = 8.5%, 1%/yr amortisation (0.6)
//   Junior notes 1.0x     = 20 @ 12% fixed, no amortisation
//   Year 1 opening 80; annualised interest = 60*8.5% + 20*12% = 5.1 + 2.4 = 7.5; closing 79.4
import { debtStructure, type DebtStructureInput } from "./debt-structure";
import { validate } from "@/lib/skills/validate";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "analyst" };

const input: DebtStructureInput = {
  dealName: "Acme",
  entryEbitda: 20,
  baseRatePct: 4,
  totalUses: 160,
  tranches: [
    { name: "Term loan B", seniority: "senior", multiple: 3, marginBps: 450, amortPctPerYear: 1, tenorYears: 7 },
    { name: "Junior notes", seniority: "junior", amount: 20, fixedRatePct: 12, amortPctPerYear: 0, tenorYears: 8 },
  ],
  base: {
    periods: [
      { label: "Y1", ebitdaLtm: 22, capex: 4, cashTaxes: 3 },
      { label: "Y2", ebitdaLtm: 24, capex: 4, cashTaxes: 3 },
    ],
  },
  downside: {
    periods: [
      { label: "Y1", ebitdaLtm: 16, capex: 4, cashTaxes: 2 },
      { label: "Y2", ebitdaLtm: 15, capex: 4, cashTaxes: 2 },
    ],
  },
  covenants: [
    { name: "Net leverage", kind: "maxLeverage", threshold: 5, definitionSource: "TS p.7" },
    { name: "Interest cover", kind: "minInterestCover", threshold: 2, definitionSource: "TS p.8" },
  ],
};
const run = (i: DebtStructureInput) => debtStructure.run(i, ctx);

describe("debt-structure core", () => {
  it("resolves tranches: size from a multiple, floating vs fixed pricing, annual interest and amortisation", () => {
    const r = run(input).structured;
    const [tlb, notes] = r.tranches;
    expect(tlb).toMatchObject({ amount: 60, multiple: 3, ratePct: 8.5, annualInterest: 5.1, annualAmort: 0.6, issue: null });
    expect(notes).toMatchObject({ amount: 20, multiple: 1, ratePct: 12, annualInterest: 2.4, annualAmort: 0 });
    expect(r.closing).toEqual({ totalDebt: 80, totalLeverage: 4, seniorLeverage: 3, equityPctOfSources: 50 });
  });

  it("rolls the balance with amortisation only and computes leverage, interest cover and fixed-charge cover", () => {
    const r = run(input).structured;
    expect(r.base[0]).toMatchObject({ period: "Y1", openingDebt: 80, interest: 7.5, mandatoryAmort: 0.6, closingDebt: 79.4 });
    expect(r.base[0].leverage).toBe(3.61); // 79.4 / 22
    expect(r.base[0].interestCover).toBe(2.93); // 22 / 7.5
    expect(r.base[0].fixedChargeCover).toBe(1.85); // (22 - 4 - 3) / (7.5 + 0.6)
    // Year 2: senior opens at 59.4 -> interest 59.4*8.5% + 2.4 = 7.449
    expect(r.base[1].openingDebt).toBe(79.4);
    expect(r.base[1].interest).toBe(7.45);
    expect(r.base[1].leverage).toBe(3.28); // 78.8 / 24
  });

  it("tests covenants in both cases and reports headroom at the TIGHTEST period", () => {
    const r = run(input).structured;
    const lev = r.covenants.find((c) => c.name === "Net leverage")!;
    // base: Y1 3.61x vs 5.0x -> headroom (5 - 3.61)/5 = 27.8%
    expect(lev.base).toMatchObject({ tightestPeriod: "Y1", metric: 3.61, status: "ok" });
    // downside: Y1 79.4/16 = 4.96x ; Y2 78.8/15 = 5.25x -> Y2 is the tightest and breaches
    expect(lev.downside).toMatchObject({ tightestPeriod: "Y2", metric: 5.25, status: "breach" });
    expect(lev.downside!.headroomPct).toBe(-5);
    const ic = r.covenants.find((c) => c.name === "Interest cover")!;
    // downside interest cover: Y1 16 / 7.5 = 2.13x ; Y2 15 / 7.45 = 2.01x -> Y2 is the tightest, and the headroom is measured there
    expect(ic.downside).toMatchObject({ tightestPeriod: "Y2", metric: 2.01, status: "warning" });
    expect(ic.downside!.headroomPct).toBe(0.5); // (2.01 - 2) / 2
  });

  it("flags a covenant with no term-sheet source, and a missing downside", () => {
    const r = run({ ...input, downside: undefined, covenants: [{ name: "Leverage", kind: "maxLeverage", threshold: 5 }] });
    expect(r.missingData.join(" ")).toMatch(/Covenant "Leverage" cites no term-sheet source/);
    expect(r.missingData.join(" ")).toMatch(/No downside case/);
    expect(r.structured.covenants[0].definitionSource).toBeNull();
    expect(r.structured.covenants[0].downside).toBeNull();
    expect(r.structured.downside).toBeNull();
  });

  it("tests the structure against the firm's limits, and labels the default policy", () => {
    const def = run(input).structured;
    expect(def.financingPolicyIsDefault).toBe(true);
    expect(def.policyChecks.find((c) => c.check === "Senior leverage at close")).toMatchObject({ result: "pass" }); // 3.0x vs default 4.0x
    expect(def.policyChecks.find((c) => c.check === "Total leverage at close")?.result).toBe("not-tested");

    const firm = run({ ...input, financing: { covenantWarnHeadroomPct: 20, maxSeniorLeverage: 2.5, maxTotalLeverage: 3.5, minInterestCoverDownside: 2.5, minEquityPct: 60 } }).structured;
    expect(firm.financingPolicyIsDefault).toBe(false);
    const by = Object.fromEntries(firm.policyChecks.map((c) => [c.check, c.result]));
    expect(by).toEqual({
      "Senior leverage at close": "fail",
      "Total leverage at close": "fail",
      "Interest cover in the downside": "fail", // lowest 2.01x < 2.5x
      "Equity contribution": "fail", // 50% < 60%
    });
  });

  it("an unsized or unpriced tranche is flagged and its metrics are not invented", () => {
    const r = run({ ...input, tranches: [{ name: "Mystery", seniority: "senior", amortPctPerYear: 1 }, input.tranches[1]] });
    expect(r.structured.tranches[0].issue).toMatch(/No size/);
    expect(r.structured.closing.totalDebt).toBeNull();
    expect(r.structured.base[0].interest).toBeNull();
    expect(r.structured.base[0].interestCover).toBeNull();
    expect(r.missingData.join(" ")).toMatch(/Mystery: No size/);
  });

  it("a floating tranche with no base rate, and an ambiguous size, are flagged", () => {
    const r = run({ ...input, baseRatePct: undefined, tranches: [{ ...input.tranches[0], amount: 60 }] });
    expect(r.structured.tranches[0].issue).toMatch(/either an amount or a multiple/);
    expect(r.structured.tranches[0].amount).toBeNull();
    const noBase = run({ ...input, baseRatePct: undefined });
    expect(noBase.structured.tranches[0].issue).toMatch(/needs the base rate/);
  });

  it("fixed-charge cover needs capex and taxes; without them it is null, never zero", () => {
    const r = run({ ...input, base: { periods: [{ label: "Y1", ebitdaLtm: 22 }] } }).structured;
    expect(r.base[0].fixedChargeCover).toBeNull();
    expect(r.base[0].leverage).toBe(3.61);
  });

  it("amortisation is capped at the remaining balance, and a shorter period scales interest base and amortisation", () => {
    const r = run({ ...input, tranches: [{ name: "Amortising", seniority: "senior", amount: 10, marginBps: 0, amortPctPerYear: 60 }], base: { periods: [{ label: "H1", ebitdaLtm: 10, periodYears: 0.5 }, { label: "H2", ebitdaLtm: 10, periodYears: 2 }] } }).structured;
    expect(r.base[0].mandatoryAmort).toBe(3); // 60% of 10 = 6 a year, for half a year
    expect(r.base[0].closingDebt).toBe(7);
    // Two years at 6 a year would be 12, but only 7 remains: amortisation is capped at the balance.
    expect(r.base[1].mandatoryAmort).toBe(7);
    expect(r.base[1].closingDebt).toBe(0);
  });

  it("is deterministic, validates against its schema, and names the gate", () => {
    const a = run(input);
    expect(JSON.stringify(run(input).structured)).toBe(JSON.stringify(a.structured));
    expect(validate(a.structured, debtStructure.manifest.outputSchema).valid).toBe(true);
    expect(validate(input, debtStructure.manifest.inputSchema).valid).toBe(true);
    expect(a.structured.gate).toBe("The financing lead approves the structure before lenders see it.");
    expect(run({ ...input, gateOwner: "Jane Doe, financing lead" }).structured.gate).toMatch(/^Jane Doe, financing lead approves/);
    expect(a.structured.assumptions.join(" ")).toMatch(/No cash sweep/);
  });
});
