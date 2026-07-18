// Golden tests for the unit-economics deterministic core.
import { unitEconomics, type UnitEconomicsInput } from "./unit-economics";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "analyst" };
const run = (input: UnitEconomicsInput) => unitEconomics.run(input, ctx);

describe("unit-economics core", () => {
  it("computes healthy unit economics and labels every figure by epistemic kind", () => {
    const r = run({ companyName: "HealthySaaS", arpu: 1200, cac: 1500, grossMarginPct: 80, churnRatePct: 20 });
    expect(r.structured.annualGrossProfitPerUser).toBe(960); // 1200 × 0.80
    expect(r.structured.ltv).toBe(4800); // 960 ÷ 0.20
    expect(r.structured.ltvCacRatio).toBe(3.2); // 4800 ÷ 1500
    expect(r.structured.paybackMonths).toBe(18.8); // 1500 ÷ (960 ÷ 12) = 18.75 → 18.8
    expect(r.structured.band).toBe("healthy");
    expect(r.structured.missingFields).toEqual([]);
    expect(r.structured.keyRisks).toEqual([]);
    // Provided figures are FACTS; computed figures are CALCULATIONS — never collapsed.
    expect(r.sources.find((s) => s.label === "ARPU")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "LTV")?.kind).toBe("calculation");
    expect(r.sources.find((s) => s.label === "LTV / CAC ratio")?.kind).toBe("calculation");
  });

  it("guards divide-by-zero: churn 0 → LTV undefined, not a fabricated number", () => {
    const r = run({ companyName: "ZeroChurn", arpu: 1000, cac: 500, grossMarginPct: 60, churnRatePct: 0 });
    expect(r.structured.annualGrossProfitPerUser).toBe(600);
    expect(r.structured.ltv).toBeNull();
    expect(r.structured.ltvCacRatio).toBeNull();
    expect(r.structured.band).toBeNull();
    expect(r.structured.paybackMonths).toBe(10); // 500 ÷ (600 ÷ 12) = 10
    expect(r.structured.keyRisks).toContain("Churn rate 0 — LTV undefined");
    // Churn is present (a fact), so it is NOT flagged as missing.
    expect(r.structured.missingFields).toEqual([]);
  });

  it("flags an unhealthy band and a long payback as key risks", () => {
    const r = run({ companyName: "BurnCo", arpu: 1000, cac: 2000, grossMarginPct: 50, churnRatePct: 50 });
    expect(r.structured.ltv).toBe(1000); // 500 ÷ 0.50
    expect(r.structured.ltvCacRatio).toBe(0.5); // 1000 ÷ 2000
    expect(r.structured.band).toBe("unhealthy");
    expect(r.structured.paybackMonths).toBe(48); // 2000 ÷ (500 ÷ 12) = 48
    expect(r.structured.keyRisks).toEqual(expect.arrayContaining(["Long payback (>24mo)", "LTV/CAC below 1 — acquisition uneconomic"]));
  });

  it("lands in the watch band when 1 ≤ LTV/CAC < 3", () => {
    const r = run({ companyName: "MiddleCo", arpu: 1000, cac: 1000, grossMarginPct: 50, churnRatePct: 25 });
    expect(r.structured.ltv).toBe(2000); // 500 ÷ 0.25
    expect(r.structured.ltvCacRatio).toBe(2); // 2000 ÷ 1000
    expect(r.structured.band).toBe("watch");
  });

  it("watches and FLAGS missing data instead of inventing it", () => {
    const r = run({ companyName: "Mystery Co" });
    expect(r.structured.annualGrossProfitPerUser).toBeNull();
    expect(r.structured.ltv).toBeNull();
    expect(r.structured.ltvCacRatio).toBeNull();
    expect(r.structured.paybackMonths).toBeNull();
    expect(r.structured.band).toBeNull();
    expect(r.structured.missingFields).toEqual(expect.arrayContaining(["ARPU", "CAC", "Gross margin %", "Churn rate %"]));
    // Nothing fabricated: no fact source carries an ARPU number.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "ARPU")).toBe(false);
    expect(r.completeness).toBe(0);
  });

  it("always produces a recommended next action and a narrative", () => {
    const r = run({ companyName: "X" });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});
