// Golden tests for the nav-review deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { navReview, navReviewManifest, type NavReviewInput } from "./nav-review";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "fund_admin" };
const run = (input: NavReviewInput) => navReview.run(input, ctx);

describe("nav-review core", () => {
  it("rolls prior NAV forward through signed flows and ties out to the reported NAV", () => {
    const r = run({
      fundName: "Meridian Fund II",
      priorNav: 1000,
      contributions: 200,
      distributions: 50,
      realizedGainLoss: 30,
      unrealizedGainLoss: 40,
      fees: 10,
      expenses: 5,
      reportedNav: 1205, // 1000 + 200 − 50 + 30 + 40 − 10 − 5
    });
    expect(r.structured.computedNav).toBe(1205);
    expect(r.structured.tieOutDifference).toBe(0);
    expect(r.structured.tiesOut).toBe(true);
    // Distributions, fees, and expenses are carried as negative signed amounts.
    const line = (c: string) => r.structured.rollForward.find((l) => l.component === c)?.amount;
    expect(line("Prior NAV")).toBe(1000);
    expect(line("Contributions")).toBe(200);
    expect(line("Distributions")).toBe(-50);
    expect(line("Fees")).toBe(-10);
    // The computed NAV is a CALCULATION, never a fact.
    expect(r.sources.find((s) => s.label === "Computed NAV")?.kind).toBe("calculation");
  });

  it("flags a reported NAV that does not tie to the roll-forward", () => {
    const r = run({ fundName: "Meridian Fund II", priorNav: 1000, contributions: 200, reportedNav: 1210 });
    expect(r.structured.computedNav).toBe(1200);
    expect(r.structured.tieOutDifference).toBe(10); // 1210 − 1200
    expect(r.structured.tiesOut).toBe(false);
    expect(r.structured.keyRisks).toContain("Reported NAV does not tie to the roll-forward");
  });

  it("FLAGS a missing prior NAV instead of assuming it, and returns a null computed NAV", () => {
    const r = run({ fundName: "Orphan Fund", contributions: 100, reportedNav: 500 });
    expect(r.structured.computedNav).toBeNull();
    expect(r.structured.tieOutDifference).toBeNull();
    expect(r.structured.tiesOut).toBe(false);
    expect(r.structured.missingFields).toContain("Prior NAV");
    // Nothing fabricated: no fact source carries a prior-NAV number.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Prior NAV")).toBe(false);
    // The roll-forward omits a fabricated Prior NAV line.
    expect(r.structured.rollForward.some((l) => l.component === "Prior NAV")).toBe(false);
  });

  it("defaults absent flow components to 0 but LABELS them as assumptions", () => {
    const r = run({ fundName: "Sparse Fund", priorNav: 1000 });
    expect(r.structured.computedNav).toBe(1000); // all flows assumed 0
    const assumptions = r.sources.filter((s) => s.kind === "assumption");
    expect(assumptions.length).toBe(6); // six flow components
    expect(assumptions.every((s) => s.label.startsWith("Assumed ") && s.label.endsWith("= 0"))).toBe(true);
    // A defaulted component is never recorded as a fact.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Contributions")).toBe(false);
  });

  it("flags a missing reported NAV as an open tie-out item", () => {
    const r = run({ fundName: "Pending Fund", priorNav: 1000, contributions: 50 });
    expect(r.structured.missingFields).toContain("Reported NAV");
    expect(r.structured.tieOutDifference).toBeNull();
    expect(r.structured.tiesOut).toBe(false);
  });

  it("only PREPARES the tie-out — the recommendation defers NAV approval to a human", () => {
    const r = run({ fundName: "Meridian Fund II", priorNav: 1000, reportedNav: 1000 });
    expect(r.structured.tiesOut).toBe(true);
    expect(r.structured.recommendedAction.toLowerCase()).toContain("human");
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});

describe("nav-review package consistency", () => {
  const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/nav-review/input.schema.json")).toEqual(navReviewManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/nav-review/output.schema.json")).toEqual(navReviewManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/nav-review/examples/example-1.json") as { input: unknown };
    const res = validate(example.input, navReviewManifest.inputSchema);
    expect(res.valid).toBe(true);
  });
});
