// Golden tests for the comps (comparable company analysis) deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { comps, compsManifest, type CompsInput } from "./comps";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "analyst" };
const run = (input: CompsInput) => comps.run(input, ctx);

describe("comps core", () => {
  it("computes multiple statistics and triangulates an implied valuation", () => {
    // evEbitda [8,10,12] → median 10; evRevenue [2,2.5,3] → median 2.5;
    // peRatio [15,18,20] → median 18, mean 17.7.
    const r = run({
      subject: { companyName: "TargetCo", ebitda: 20, revenue: 100, netIncome: 10 },
      comparables: [
        { name: "Alpha", evEbitda: 8, evRevenue: 2, peRatio: 15 },
        { name: "Beta", evEbitda: 10, evRevenue: 3, peRatio: 18 },
        { name: "Gamma", evEbitda: 12, evRevenue: 2.5, peRatio: 20 },
      ],
    });
    expect(r.structured.multiples.evEbitda).toEqual({ count: 3, median: 10, mean: 10, min: 8, max: 12 });
    expect(r.structured.multiples.evRevenue).toEqual({ count: 3, median: 2.5, mean: 2.5, min: 2, max: 3 });
    expect(r.structured.multiples.peRatio).toEqual({ count: 3, median: 18, mean: 17.7, min: 15, max: 20 });
    // Implied: 10×20=200, 2.5×100=250, 18×10=180. EV range = min/max of the two EVs.
    expect(r.structured.impliedValuation.impliedEvFromEbitda).toBe(200);
    expect(r.structured.impliedValuation.impliedEvFromRevenue).toBe(250);
    expect(r.structured.impliedValuation.impliedEquityFromPe).toBe(180);
    expect(r.structured.impliedValuation.evRangeLow).toBe(200);
    expect(r.structured.impliedValuation.evRangeHigh).toBe(250);
    expect(r.structured.missingFields).toHaveLength(0);
    // The median multiple is a CALCULATION, never a fact.
    expect(r.sources.find((s) => s.label === "Median EV/EBITDA")?.kind).toBe("calculation");
    // Provided comparable multiples are FACTS.
    expect(r.sources.find((s) => s.label === "Alpha EV/EBITDA")?.kind).toBe("fact");
  });

  it("averages the two middle values on an even comparable count", () => {
    // evEbitda [6,8,10,12] → median (8+10)/2 = 9.
    const r = run({
      subject: { companyName: "EvenCo", ebitda: 10 },
      comparables: [
        { name: "A", evEbitda: 6 },
        { name: "B", evEbitda: 8 },
        { name: "C", evEbitda: 10 },
        { name: "D", evEbitda: 12 },
      ],
    });
    expect(r.structured.multiples.evEbitda?.median).toBe(9);
    expect(r.structured.impliedValuation.impliedEvFromEbitda).toBe(90); // 9 × 10
  });

  it("flags missing subject metrics and empty multiples instead of inventing them", () => {
    const r = run({
      subject: { companyName: "Mystery Co" },
      comparables: [{ name: "OnlyPeer", evEbitda: 8 }],
    });
    expect(r.structured.impliedValuation.impliedEvFromEbitda).toBeNull(); // subject EBITDA missing
    expect(r.structured.impliedValuation.impliedEvFromRevenue).toBeNull();
    expect(r.structured.impliedValuation.impliedEquityFromPe).toBeNull();
    expect(r.structured.impliedValuation.evRangeLow).toBeNull();
    expect(r.structured.impliedValuation.evRangeHigh).toBeNull();
    expect(r.structured.multiples.evRevenue).toBeNull();
    expect(r.structured.multiples.peRatio).toBeNull();
    expect(r.structured.missingFields).toEqual(
      expect.arrayContaining(["EV/Revenue comparables", "P/E comparables", "Subject EBITDA", "Subject revenue", "Subject net income"]),
    );
    // Nothing fabricated: no fact source carries a subject-EBITDA number.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Subject EBITDA")).toBe(false);
  });

  it("nulls an implied value when the multiple has zero comparables even if the subject metric is present", () => {
    const r = run({
      subject: { companyName: "PartialCo", ebitda: 20, revenue: 100 },
      comparables: [
        { name: "A", evRevenue: 2 },
        { name: "B", evRevenue: 3 },
        { name: "C", evRevenue: 4 },
      ],
    });
    expect(r.structured.multiples.evEbitda).toBeNull();
    expect(r.structured.impliedValuation.impliedEvFromEbitda).toBeNull(); // no EV/EBITDA comps
    expect(r.structured.impliedValuation.impliedEvFromRevenue).toBe(300); // median 3 × 100
    expect(r.structured.missingFields).toContain("EV/EBITDA comparables");
  });

  it("surfaces a thin-comparable-set risk below three comparables", () => {
    const r = run({
      subject: { companyName: "ThinCo", ebitda: 20 },
      comparables: [{ name: "A", evEbitda: 8 }, { name: "B", evEbitda: 10 }],
    });
    expect(r.structured.keyRisks).toContain("Thin comparable set (<3) — treat as indicative");
  });

  it("always produces a recommended action and a narrative", () => {
    const r = run({ subject: { companyName: "X" }, comparables: [] });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
    expect(r.completeness).toBe(0);
  });
});

// The TS manifest is the runtime contract; the /skills/comps package mirrors it.
describe("comps package consistency", () => {
  const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/comps/input.schema.json")).toEqual(compsManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/comps/output.schema.json")).toEqual(compsManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/comps/examples/example-1.json") as { input: unknown };
    const result = validate(example.input, compsManifest.inputSchema);
    expect(result.valid).toBe(true);
  });
});
