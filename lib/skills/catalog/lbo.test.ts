// Golden tests for the lbo deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { lbo, lboManifest, type LboInput } from "./lbo";
import type { SkillContext } from "@/lib/skills/types";

const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "analyst" };
const run = (input: LboInput) => lbo.run(input, ctx);

describe("lbo core", () => {
  it("computes a clean LBO: sources & uses, exit equity, MOIC and IRR", () => {
    const r = run({
      entryEbitda: 100,
      entryMultiple: 10,
      debtAmount: 600,
      holdYears: 5,
      exitMultiple: 12,
      ebitdaGrowthRate: 0,
      annualDebtPaydown: 100,
      transactionFeesPct: 0,
    });
    const o = r.structured;
    expect(o.entryEV).toBe(1000); // 100 × 10
    expect(o.debt).toBe(600); // supplied directly
    expect(o.entryEquity).toBe(400); // 1000 + 0 fees − 600
    expect(o.exitEbitda).toBe(100); // 100 × 1.0^5 (flat)
    expect(o.exitEV).toBe(1200); // 100 × 12
    expect(o.exitEquity).toBe(700); // 1200 − max(0, 600 − 100)
    expect(o.moic).toBe(1.75); // 700 / 400
    expect(o.irr).toBe(0.1184); // 1.75^(1/5) − 1
    expect(o.assumptions).toEqual([]); // every input supplied — no defaults
    // A supplied input is a FACT; a derived figure is a CALCULATION.
    expect(r.sources.find((s) => s.label === "Entry LTM EBITDA")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "MOIC")?.kind).toBe("calculation");
    expect(r.sources.find((s) => s.label === "Entry equity")?.kind).toBe("calculation");
  });

  it("flags a missing required input and never fabricates it (MOIC null)", () => {
    const r = run({ entryMultiple: 10, holdYears: 5, debtAmount: 500 });
    const o = r.structured;
    expect(o.moic).toBeNull();
    expect(o.irr).toBeNull();
    expect(o.exitEquity).toBeNull();
    expect(o.entryEV).toBeNull();
    expect(o.missingInputs).toContain("Entry EBITDA");
    // Nothing fabricated: no fact source carries an entry-EBITDA number.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Entry LTM EBITDA")).toBe(false);
  });

  it("defaults exitMultiple to entryMultiple as a labelled ASSUMPTION, never a fact", () => {
    const r = run({ entryEbitda: 100, entryMultiple: 10, debtAmount: 500, holdYears: 5 });
    const o = r.structured;
    // exitMultiple, growth, paydown, fees all default.
    expect(o.assumptions.some((a) => a.includes("no multiple expansion"))).toBe(true);
    expect(r.sources.find((s) => s.label === "Assumed exit multiple")?.kind).toBe("assumption");
    // No exit-multiple FACT was emitted (it was never supplied).
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Exit multiple (EV/EBITDA)")).toBe(false);
    // Exit multiple = entry multiple (10): exitEV = 100 × 10 = 1000, exitEquity = 1000 − 500 = 500.
    expect(o.exitEV).toBe(1000);
    expect(o.exitEquity).toBe(500);
    expect(o.moic).toBe(1); // 500 / 500
  });

  it("prefers debtAmount over leverageMultiple when both are supplied", () => {
    const r = run({ entryEbitda: 100, entryMultiple: 10, leverageMultiple: 8, debtAmount: 600, holdYears: 5, exitMultiple: 10 });
    // debtAmount (600) wins over leverage sizing (8 × 100 = 800).
    expect(r.structured.debt).toBe(600);
    expect(r.structured.entryEquity).toBe(400); // 1000 − 600
    // Both are recorded as facts.
    expect(r.sources.find((s) => s.label === "Debt amount")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "Leverage (net debt/EBITDA)")?.kind).toBe("fact");
  });

  it("sizes debt from leverageMultiple when debtAmount is absent", () => {
    const r = run({ entryEbitda: 100, entryMultiple: 10, leverageMultiple: 5, holdYears: 5, exitMultiple: 10 });
    expect(r.structured.debt).toBe(500); // 5 × 100
    expect(r.structured.entryEquity).toBe(500); // 1000 − 500
  });

  it("models an all-equity purchase (debt 0) as an assumption when no debt is supplied", () => {
    const r = run({ entryEbitda: 100, entryMultiple: 10, holdYears: 5, exitMultiple: 10 });
    expect(r.structured.debt).toBe(0);
    expect(r.structured.assumptions.some((a) => a.includes("all-equity"))).toBe(true);
    expect(r.structured.entryEquity).toBe(1000);
  });

  it("returns null MOIC/IRR when entry equity is non-positive", () => {
    const r = run({ entryEbitda: 100, entryMultiple: 10, debtAmount: 1200, holdYears: 5, exitMultiple: 10 });
    const o = r.structured;
    expect(o.entryEquity).toBe(-200); // 1000 + 0 − 1200
    expect(o.moic).toBeNull();
    expect(o.irr).toBeNull();
    // Exit figures are still computed; only the ratio is undefined.
    expect(o.exitEquity).not.toBeNull();
    expect(r.sources.some((s) => s.label === "MOIC")).toBe(false);
  });

  it("always produces a recommended next action and a narrative", () => {
    const r = run({});
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
    expect(r.structured.missingInputs).toEqual(expect.arrayContaining(["Entry EBITDA", "Entry multiple", "Hold years"]));
  });
});

describe("lbo package consistency", () => {
  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/lbo/input.schema.json")).toEqual(lboManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/lbo/output.schema.json")).toEqual(lboManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/lbo/examples/example-1.json") as { input: unknown };
    const r = validate(example.input, lboManifest.inputSchema);
    expect(r.valid).toBe(true);
  });
});
