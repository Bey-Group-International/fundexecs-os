// Golden tests for the portfolio-review deterministic core.
import { portfolioReview, type PortfolioReviewInput } from "./portfolio-review";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "portfolio_ops" };
const run = (input: PortfolioReviewInput) => portfolioReview.run(input, ctx);

describe("portfolio-review core", () => {
  it("computes budget-to-actual variance on revenue and EBITDA and clears clean covenants", () => {
    const r = run({
      companyName: "Portco One",
      period: "Q2 2026",
      budgetRevenue: 100,
      actualRevenue: 105,
      budgetEbitda: 20,
      actualEbitda: 21,
      covenants: [
        { name: "Min DSCR", threshold: 1.2, actual: 1.5, type: "min" },
        { name: "Max Leverage", threshold: 4.0, actual: 3.5, type: "max" },
      ],
    });
    const o = r.structured;
    expect(o.revenueVariance).toBe(5); // 105 − 100
    expect(o.revenueVariancePct).toBe(5); // 5 / 100 × 100
    expect(o.ebitdaVariance).toBe(1); // 21 − 20
    expect(o.ebitdaVariancePct).toBe(5); // 1 / 20 × 100
    expect(o.covenantChecks.map((c) => c.status)).toEqual(["pass", "pass"]);
    expect(o.breaches).toEqual([]);
    expect(o.keyRisks).toEqual([]);
    // The variance is a CALCULATION, never a fact.
    expect(r.sources.find((s) => s.label === "Revenue variance")?.kind).toBe("calculation");
    // The provided budget is a FACT.
    expect(r.sources.find((s) => s.label === "Budget revenue")?.kind).toBe("fact");
  });

  it("flags a covenant breach on both a min and a max covenant", () => {
    const r = run({
      companyName: "Portco Two",
      period: "Q2 2026",
      budgetRevenue: 100,
      actualRevenue: 98,
      budgetEbitda: 20,
      actualEbitda: 19,
      covenants: [
        { name: "Min DSCR", threshold: 1.2, actual: 1.0, type: "min" },
        { name: "Max Leverage", threshold: 4.0, actual: 5.0, type: "max" },
      ],
    });
    const o = r.structured;
    expect(o.covenantChecks.map((c) => c.status)).toEqual(["breach", "breach"]);
    expect(o.breaches).toEqual(["Min DSCR", "Max Leverage"]);
    expect(o.keyRisks).toEqual(expect.arrayContaining(["Covenant breach: Min DSCR.", "Covenant breach: Max Leverage."]));
    expect(o.recommendedAction).toContain("Escalate covenant breach");
    // Covenant status is derived, a CALCULATION.
    expect(r.sources.find((s) => s.label === 'Covenant "Min DSCR" status')?.kind).toBe("calculation");
  });

  it("surfaces a material (>10%) budget shortfall as a key risk", () => {
    const r = run({
      companyName: "Portco Three",
      budgetRevenue: 100,
      actualRevenue: 90, // −10% exactly, on the threshold
      budgetEbitda: 20,
      actualEbitda: 15, // −25%
    });
    const o = r.structured;
    expect(o.revenueVariancePct).toBe(-10);
    expect(o.ebitdaVariancePct).toBe(-25);
    expect(o.keyRisks).toEqual(expect.arrayContaining(["Revenue -10% below budget (>10% shortfall).", "EBITDA -25% below budget (>10% shortfall)."]));
    expect(o.recommendedAction).toContain("Investigate the budget shortfall");
  });

  it("flags missing data instead of inventing it", () => {
    const r = run({ companyName: "Mystery Portco" });
    const o = r.structured;
    expect(o.revenueVariance).toBeNull();
    expect(o.revenueVariancePct).toBeNull();
    expect(o.ebitdaVariance).toBeNull();
    expect(o.ebitdaVariancePct).toBeNull();
    expect(o.covenantChecks).toEqual([]);
    expect(o.breaches).toEqual([]);
    expect(o.missingFields).toEqual(expect.arrayContaining(["Period", "Budget revenue", "Actual revenue", "Budget EBITDA", "Actual EBITDA"]));
    // Nothing fabricated: no fact source carries a revenue number.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Actual revenue")).toBe(false);
    expect(r.completeness).toBeLessThan(0.5);
  });

  it("marks a covenant with missing data as unknown, not pass or breach", () => {
    const r = run({
      companyName: "Portco Four",
      covenants: [{ name: "Interest Cover", type: "min" }],
    });
    const o = r.structured;
    expect(o.covenantChecks[0].status).toBe("unknown");
    expect(o.covenantChecks[0].threshold).toBeNull();
    expect(o.covenantChecks[0].actual).toBeNull();
    expect(o.breaches).toEqual([]);
    expect(o.missingFields).toEqual(expect.arrayContaining(['Covenant "Interest Cover" — threshold, actual, or type missing']));
    // Nothing fabricated: no covenant-status calculation source for an unknown covenant.
    expect(r.sources.some((s) => s.label === 'Covenant "Interest Cover" status')).toBe(false);
  });

  it("does not divide by a zero budget — variance % is null", () => {
    const r = run({ companyName: "ZeroBudget", budgetRevenue: 0, actualRevenue: 10 });
    expect(r.structured.revenueVariance).toBe(10); // still computable
    expect(r.structured.revenueVariancePct).toBeNull(); // no divide-by-zero
  });

  it("always produces a recommended next action and a narrative", () => {
    const r = run({ companyName: "X" });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});
