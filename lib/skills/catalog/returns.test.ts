// Golden tests for the returns (preliminary LBO) deterministic core.
import { returns, type ScreenReturnsInput } from "./returns";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "analyst" };
const run = (input: ScreenReturnsInput) => returns.run(input, ctx);

describe("returns core", () => {
  it("computes a clean MOIC and IRR with correct LBO math", () => {
    // entryEv = 10 * 10 = 100; entryEquity = 100 - 50 = 50.
    // remainingDebt = max(0, 50 - 10*5) = 0.
    // exitEbitda = 10 (cagr 0); exitEv = 10 * 10 = 100; exitEquity = 100.
    // moic = 100/50 = 2.00; irr = 2^(1/5) - 1 = 14.9%.
    const r = run({
      deal: { companyName: "LevCo", entryEbitda: 10, entryMultiple: 10, netDebt: 50 },
      assumptions: { holdYears: 5, exitMultiple: 10, ebitdaCagr: 0, annualDebtPaydown: 10 },
    });
    expect(r.structured.entryEv).toBe(100);
    expect(r.structured.entryEquity).toBe(50);
    expect(r.structured.exitEbitda).toBe(10);
    expect(r.structured.exitEv).toBe(100);
    expect(r.structured.remainingDebt).toBe(0);
    expect(r.structured.exitEquity).toBe(100);
    expect(r.structured.moic).toBe(2);
    expect(r.structured.irrPct).toBe(14.9);
    // MOIC is recorded as a CALCULATION, never a fact.
    expect(r.sources.find((s) => s.label === "MOIC")?.kind).toBe("calculation");
  });

  it("grows EBITDA at the provided CAGR", () => {
    // exitEbitda = 20 * 1.1^5 = 32.21 (round 2dp).
    const r = run({
      deal: { companyName: "GrowthCo", entryEbitda: 20, entryMultiple: 8, netDebt: 40 },
      assumptions: { holdYears: 5, ebitdaCagr: 0.1 },
    });
    expect(r.structured.exitEbitda).toBe(32.21);
  });

  it("flags missing data instead of inventing it", () => {
    const r = run({ deal: { companyName: "Mystery Co" } });
    expect(r.structured.moic).toBeNull();
    expect(r.structured.irrPct).toBeNull();
    expect(r.structured.entryEv).toBeNull();
    expect(r.structured.missingFields).toEqual(expect.arrayContaining(["Entry EBITDA", "Entry multiple"]));
    // Nothing fabricated: no fact source carries an entry-EBITDA number.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Entry EBITDA")).toBe(false);
    expect(r.structured.sensitivities).toHaveLength(0);
  });

  it("labels defaults as assumptions, never as facts", () => {
    const r = run({ deal: { companyName: "BareCo", entryEbitda: 10, entryMultiple: 9 } });
    // Hold years, exit multiple, CAGR and debt paydown all defaulted.
    expect(r.structured.assumptionsUsed.length).toBeGreaterThanOrEqual(4);
    expect(r.structured.assumptionsUsed.some((x) => x.includes("5 years"))).toBe(true);
    expect(r.structured.assumptionsUsed.some((x) => x.includes("assumed = entry multiple"))).toBe(true);
    // Each defaulted value is an ASSUMPTION source, not a fact.
    expect(r.sources.find((s) => s.label === "Assumed hold period")?.kind).toBe("assumption");
    expect(r.sources.find((s) => s.label === "Assumed exit multiple")?.kind).toBe("assumption");
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Assumed exit multiple")).toBe(false);
  });

  it("returns three sensitivities ordered bull > base > bear", () => {
    const r = run({
      deal: { companyName: "SensCo", entryEbitda: 15, entryMultiple: 9, netDebt: 60 },
      assumptions: { holdYears: 5, exitMultiple: 9 },
    });
    const s = r.structured.sensitivities;
    expect(s.map((p) => p.scenario)).toEqual(["bear", "base", "bull"]);
    const bear = s[0].moic!;
    const base = s[1].moic!;
    const bull = s[2].moic!;
    expect(bull).toBeGreaterThan(base);
    expect(base).toBeGreaterThan(bear);
    // The base scenario's exit multiple matches the effective exit multiple.
    expect(s[1].exitMultiple).toBe(9);
    expect(s[0].exitMultiple).toBe(8);
    expect(s[2].exitMultiple).toBe(10);
    // Base sensitivity MOIC ties to the headline MOIC.
    expect(base).toBe(r.structured.moic);
  });

  it("derives entry equity from EV minus net debt when no equity check is given", () => {
    const r = run({ deal: { companyName: "DerivedCo", entryEbitda: 12, entryMultiple: 10, netDebt: 70 } });
    expect(r.structured.entryEv).toBe(120);
    expect(r.structured.entryEquity).toBe(50); // 120 - 70
  });

  it("uses a provided equity contribution over the derivation", () => {
    const r = run({ deal: { companyName: "EquityCo", entryEbitda: 12, entryMultiple: 10, netDebt: 70, equityContribution: 45 } });
    expect(r.structured.entryEquity).toBe(45);
  });

  it("always produces a recommended action and a narrative", () => {
    const r = run({ deal: { companyName: "X" } });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});
