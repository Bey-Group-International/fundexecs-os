// Golden tests for the value-creation deterministic core.
import { valueCreation, type ValueCreationInput } from "./value-creation";
import { validate } from "../validate";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "portfolio_ops" };
const run = (input: ValueCreationInput) => valueCreation.run(input, ctx);

describe("value-creation core", () => {
  it("bridges EBITDA from initiatives and computes the gap to target", () => {
    const r = run({
      companyName: "Portfolio Co",
      currentEbitda: 100,
      targetEbitda: 150,
      initiatives: [
        { name: "Pricing", ebitdaImpact: 20, workstream: "Commercial", timelineMonths: 2 },
        { name: "Procurement", ebitdaImpact: 15, workstream: "Operations", timelineMonths: 6 },
      ],
    });
    expect(r.structured.bridgedEbitda).toBe(135); // 100 + 20 + 15
    expect(r.structured.gapToTarget).toBe(15); // 150 - 135
    // The bridge is a CALCULATION, never a fact.
    expect(r.sources.find((s) => s.label === "Bridged EBITDA")?.kind).toBe("calculation");
  });

  it("orders the EBITDA bridge Current → initiatives → Bridged", () => {
    const r = run({
      companyName: "Portfolio Co",
      currentEbitda: 50,
      initiatives: [
        { name: "A", ebitdaImpact: 5 },
        { name: "B", ebitdaImpact: 10 },
      ],
    });
    expect(r.structured.ebitdaBridge.map((s) => s.step)).toEqual(["Current EBITDA", "A", "B", "Bridged EBITDA"]);
    expect(r.structured.ebitdaBridge[0].amount).toBe(50);
    expect(r.structured.ebitdaBridge[r.structured.ebitdaBridge.length - 1].amount).toBe(65);
  });

  it("ranks initiatives by EBITDA impact descending, missing impact last", () => {
    const r = run({
      companyName: "Portfolio Co",
      currentEbitda: 100,
      initiatives: [
        { name: "Small", ebitdaImpact: 3 },
        { name: "Unknown" },
        { name: "Big", ebitdaImpact: 30 },
      ],
    });
    expect(r.structured.rankedInitiatives.map((i) => i.name)).toEqual(["Big", "Small", "Unknown"]);
    expect(r.structured.rankedInitiatives[2].ebitdaImpact).toBeNull();
  });

  it("treats a missing initiative impact as 0 and FLAGS it instead of inventing it", () => {
    const r = run({
      companyName: "Portfolio Co",
      currentEbitda: 100,
      initiatives: [{ name: "No-number", workstream: "Ops" }],
    });
    expect(r.structured.bridgedEbitda).toBe(100); // impact treated as 0
    expect(r.structured.missingFields).toEqual(expect.arrayContaining(['Initiative "No-number" EBITDA impact (treated as 0)']));
    // Nothing fabricated: no fact source carries an impact for this initiative.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === 'Initiative "No-number" EBITDA impact')).toBe(false);
  });

  it("derives the 100-day plan from initiatives realisable in <=3 months", () => {
    const r = run({
      companyName: "Portfolio Co",
      currentEbitda: 100,
      initiatives: [
        { name: "Quick win", ebitdaImpact: 5, timelineMonths: 1 },
        { name: "At the line", ebitdaImpact: 4, timelineMonths: 3 },
        { name: "Slow burn", ebitdaImpact: 8, timelineMonths: 12 },
      ],
    });
    expect(r.structured.hundredDayPlan).toEqual(["Quick win", "At the line"]);
    expect(r.sources.find((s) => s.label === "100-day plan")?.kind).toBe("generated");
  });

  it("notes when no timelines are provided for a 100-day plan", () => {
    const r = run({
      companyName: "Portfolio Co",
      currentEbitda: 100,
      initiatives: [{ name: "Untimed", ebitdaImpact: 5 }],
    });
    expect(r.structured.hundredDayPlan).toEqual([]);
    expect(r.structured.keyRisks).toContain("No 100-day (<=3mo) initiatives identified");
  });

  it("surfaces a key risk when initiatives do not close the gap to target", () => {
    const r = run({
      companyName: "Portfolio Co",
      currentEbitda: 100,
      targetEbitda: 200,
      initiatives: [{ name: "Modest", ebitdaImpact: 10 }],
    });
    expect(r.structured.gapToTarget).toBe(90); // 200 - 110
    expect(r.structured.keyRisks).toContain("Initiatives do not close the EBITDA gap (90 remaining)");
  });

  it("flags missing headline inputs and leaves bridge null when current EBITDA is absent", () => {
    const r = run({ companyName: "Portfolio Co", initiatives: [{ name: "X", ebitdaImpact: 5 }] });
    expect(r.structured.bridgedEbitda).toBeNull();
    expect(r.structured.gapToTarget).toBeNull();
    expect(r.structured.missingFields).toEqual(expect.arrayContaining(["Current EBITDA", "Target EBITDA"]));
    expect(r.completeness).toBeLessThan(0.5);
  });

  it("always produces a recommended action and a narrative", () => {
    const r = run({ companyName: "Bare Co" });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });

  it("produces output that validates against the manifest output schema", () => {
    const r = run({
      companyName: "Portfolio Co",
      currentEbitda: 100,
      targetEbitda: 130,
      initiatives: [{ name: "Pricing", ebitdaImpact: 20, workstream: "Commercial", timelineMonths: 2 }],
    });
    const v = validate(r.structured, valueCreation.manifest.outputSchema);
    expect(v.valid).toBe(true);
  });
});
