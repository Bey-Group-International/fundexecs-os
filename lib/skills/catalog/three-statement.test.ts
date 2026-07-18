// Golden tests for the three-statement deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { threeStatement, threeStatementManifest, type ThreeStatementInput } from "./three-statement";
import type { SkillContext } from "@/lib/skills/types";

const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "analyst" };
const run = (input: ThreeStatementInput) => threeStatement.run(input, ctx);

// A fully-specified, self-consistent driver set (opening equity omitted → plug).
const FULL: ThreeStatementInput = {
  years: 5,
  baseRevenue: 1000,
  revenueGrowth: 0.1,
  ebitdaMargin: 0.2,
  daPctOfRevenue: 0.05,
  taxRate: 0.25,
  capexPctOfRevenue: 0.06,
  nwcPctOfRevenue: 0.1,
  beginningCash: 100,
  beginningPPE: 500,
  beginningDebt: 200,
  // beginningEquity omitted — derived as a balancing plug (= 100 + 100 + 500 − 200 = 500)
};

describe("three-statement core", () => {
  it("THE KEY TEST: full model ties out — balanceCheck ≈ 0 every year AND balances === true", () => {
    const r = run(FULL);
    const o = r.structured;
    expect(o.projection).toHaveLength(5);
    for (const y of o.projection) {
      expect(Math.abs(y.balanceCheck)).toBeLessThanOrEqual(0.01);
      expect(y.balanceCheck).toBe(0); // balances by construction — exactly 0 to the cent
      // Independent tie-out: assets = liabilities + equity (within cent rounding
      // of the individually-rounded output fields).
      expect(y.cash + y.nwc + y.ppe).toBeCloseTo(y.debt + y.equity, 1);
    }
    expect(o.balances).toBe(true);
    expect(o.missingInputs).toEqual([]);
  });

  it("computes correct year-1 line items", () => {
    const y1 = run(FULL).structured.projection[0];
    expect(y1.revenue).toBe(1100); // 1000 × 1.1
    expect(y1.ebitda).toBe(220); // 0.20 × 1100
    expect(y1.ebit).toBe(165); // 220 − 55 (D&A)
    expect(y1.netIncome).toBe(123.75); // 165 × (1 − 0.25)
    expect(y1.fcf).toBe(102.75); // 123.75 + 55 − 66 − 10 (ΔNWC)
    expect(y1.cash).toBe(202.75); // 100 + 102.75
    expect(y1.ppe).toBe(511); // 500 + 66 − 55
    expect(y1.nwc).toBe(110); // 0.10 × 1100
    expect(y1.debt).toBe(200); // held constant
    expect(y1.equity).toBe(623.75); // 500 + 123.75
  });

  it("flags a missing required driver and does NOT fabricate a projection", () => {
    const { ebitdaMargin, ...rest } = FULL;
    void ebitdaMargin;
    const r = run(rest);
    const o = r.structured;
    expect(o.projection).toEqual([]); // empty — never invented
    expect(o.balances).toBe(false);
    expect(o.missingInputs).toContain("EBITDA margin");
    // Nothing fabricated: no fact source carries an EBITDA-margin value.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "EBITDA margin")).toBe(false);
    expect(r.missingData).toContain("EBITDA margin");
  });

  it("labels every supplied driver as a FACT", () => {
    const r = run(FULL);
    expect(r.sources.find((s) => s.label === "Base revenue")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "Revenue growth")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "Tax rate")?.kind).toBe("fact");
    // Projected line items are calculations, never facts.
    expect(r.sources.find((s) => s.label === "Year 1 free cash flow")?.kind).toBe("calculation");
  });

  it("labels the derived opening equity as an ASSUMPTION (plug)", () => {
    const r = run(FULL);
    const plug = r.sources.find((s) => s.label === "Derived opening equity (plug)");
    expect(plug?.kind).toBe("assumption");
    expect(plug?.value).toBe(500); // 100 + 100 + 500 − 200
    // Debt-held-constant is also an assumption.
    expect(r.sources.find((s) => s.label === "Debt held constant")?.kind).toBe("assumption");
  });

  it("flags a supplied-but-unbalanced opening balance sheet, never silently adjusting", () => {
    const r = run({ ...FULL, beginningEquity: 999 }); // correct plug would be 500
    const o = r.structured;
    // Supplied equity is a fact (not overwritten).
    expect(r.sources.find((s) => s.label === "Opening equity")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "Opening equity")?.value).toBe(999);
    // The imbalance is flagged, and it propagates so the model does not tie out.
    expect(o.missingInputs.some((m) => m.includes("does not tie out"))).toBe(true);
    expect(o.balances).toBe(false);
  });

  it("caps the horizon at 10 years", () => {
    const r = run({ ...FULL, years: 25 });
    expect(r.structured.years).toBe(10);
    expect(r.structured.projection).toHaveLength(10);
  });

  it("defaults the horizon to 5 years when omitted", () => {
    const { years, ...rest } = FULL;
    void years;
    const r = run(rest);
    expect(r.structured.years).toBe(5);
    expect(r.sources.find((s) => s.label === "Assumed projection horizon")?.kind).toBe("assumption");
  });

  it("always produces a recommended next action and a narrative", () => {
    const r = run({});
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
    expect(r.structured.projection).toEqual([]);
  });
});

describe("three-statement package consistency", () => {
  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/three-statement/input.schema.json")).toEqual(threeStatementManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/three-statement/output.schema.json")).toEqual(threeStatementManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/three-statement/examples/example-1.json") as { input: unknown };
    const r = validate(example.input, threeStatementManifest.inputSchema);
    expect(r.valid).toBe(true);
  });
});
