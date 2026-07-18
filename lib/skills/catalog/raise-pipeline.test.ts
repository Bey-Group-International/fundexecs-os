// Golden tests for the raise-pipeline deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { raisePipeline, raisePipelineManifest, type RaisePipelineInput } from "./raise-pipeline";
import type { SkillContext } from "@/lib/skills/types";

const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "capital_formation" };
const run = (input: RaisePipelineInput) => raisePipeline.run(input, ctx);

describe("raise-pipeline core", () => {
  it("rolls up a supplied prospect set into counts and expected $ by stage", () => {
    const r = run({
      raiseTarget: 1000,
      prospects: [
        { name: "LP A", stage: "committed", expectedTicket: 200, probability: 1 },
        { name: "LP B", stage: "diligence", expectedTicket: 300, probability: 0.6 },
        { name: "LP C", stage: "diligence", expectedTicket: 100, probability: 0.5 },
        { name: "LP D", stage: "contacted", expectedTicket: 50, probability: 0.2 },
      ],
    });
    expect(r.structured.totalProspects).toBe(4);
    // byStage in canonical order, only present stages.
    expect(r.structured.byStage.map((s) => s.stage)).toEqual(["contacted", "diligence", "committed"]);
    const diligence = r.structured.byStage.find((s) => s.stage === "diligence");
    expect(diligence?.count).toBe(2);
    expect(diligence?.expectedAmount).toBe(400);
  });

  it("GUARDRAIL: empty prospect set returns an empty roll-up and never invents prospects", () => {
    const r = run({ raiseTarget: 500, prospects: [] });
    expect(r.structured.byStage).toEqual([]);
    expect(r.structured.totalProspects).toBe(0);
    expect(r.structured.weightedExpected).toBe(0);
    expect(r.structured.committedAmount).toBe(0);
    expect(r.structured.missingContext).toContain(
      "No prospects supplied — this skill aggregates a provided prospect set; it does not fabricate prospects.",
    );
    // Nothing fabricated: no source carries any prospect value.
    expect(r.sources.length).toBe(0);
  });

  it("treats a missing prospects field the same as an empty set", () => {
    const r = run({});
    expect(r.structured.byStage).toEqual([]);
    expect(r.structured.totalProspects).toBe(0);
    expect(r.structured.missingContext[0]).toContain("does not fabricate prospects");
  });

  it("computes weightedExpected as a labelled calculation over non-passed prospects", () => {
    const r = run({
      prospects: [
        { name: "LP A", stage: "committed", expectedTicket: 200, probability: 1 }, // 200
        { name: "LP B", stage: "diligence", expectedTicket: 100, probability: 0.5 }, // 50
        { name: "LP P", stage: "passed", expectedTicket: 999, probability: 0.9 }, // excluded
      ],
    });
    expect(r.structured.weightedExpected).toBe(250);
    const wsrc = r.sources.find((s) => s.label === "Weighted expected commitments");
    expect(wsrc?.kind).toBe("calculation");
  });

  it("labels a defaulted probability an assumption, not a fact", () => {
    const r = run({ prospects: [{ name: "LP X", stage: "meeting", expectedTicket: 100 }] });
    const probSrc = r.sources.find((s) => s.label === "LP X — probability (stage default)");
    expect(probSrc?.kind).toBe("assumption");
    expect(probSrc?.value).toBe(0.3); // stage default for meeting
    // Weighted uses the default: 100 × 0.3 = 30.
    expect(r.structured.weightedExpected).toBe(30);
    expect(r.structured.missingContext.some((m) => m.includes("Stage-default probability applied"))).toBe(true);
  });

  it("labels a supplied expectedTicket and probability as facts", () => {
    const r = run({ prospects: [{ name: "LP Y", stage: "diligence", expectedTicket: 250, probability: 0.7 }] });
    expect(r.sources.find((s) => s.label === "LP Y — expected ticket")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "LP Y — probability")?.kind).toBe("fact");
  });

  it("sums committedAmount from committed-stage tickets as a calculation", () => {
    const r = run({
      prospects: [
        { name: "LP A", stage: "committed", expectedTicket: 200 },
        { name: "LP B", stage: "committed", expectedTicket: 150 },
        { name: "LP C", stage: "diligence", expectedTicket: 500 },
      ],
    });
    expect(r.structured.committedAmount).toBe(350);
    expect(r.sources.find((s) => s.label === "Committed amount (indicative)")?.kind).toBe("calculation");
  });

  it("returns null coverage and flags when no raise target is supplied", () => {
    const r = run({ prospects: [{ name: "LP A", stage: "committed", expectedTicket: 200, probability: 1 }] });
    expect(r.structured.coveragePct).toBeNull();
    expect(r.structured.gapToTarget).toBeNull();
    expect(r.structured.raiseTarget).toBeNull();
    expect(r.structured.missingContext.some((m) => m.includes("No raise target supplied"))).toBe(true);
    expect(r.structured.recommendedAction).toContain("set a target");
  });

  it("computes coverage and gap against a supplied target", () => {
    const r = run({
      raiseTarget: 1000,
      prospects: [{ name: "LP A", stage: "committed", expectedTicket: 400, probability: 1 }],
    });
    expect(r.structured.weightedExpected).toBe(400);
    expect(r.structured.coveragePct).toBe(40);
    expect(r.structured.gapToTarget).toBe(600);
  });

  it("flags a target supplied with no prospects rather than filling it", () => {
    const r = run({ raiseTarget: 750, prospects: [] });
    expect(r.structured.raiseTarget).toBe(750);
    expect(r.structured.weightedExpected).toBe(0);
    expect(r.structured.missingContext.some((m) => m.includes("but no prospects"))).toBe(true);
  });

  it("always produces a recommended next action and a narrative", () => {
    const r = run({ prospects: [{ name: "LP A", stage: "identified" }] });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});

describe("raise-pipeline package consistency", () => {
  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/raise-pipeline/input.schema.json")).toEqual(raisePipelineManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/raise-pipeline/output.schema.json")).toEqual(raisePipelineManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/raise-pipeline/examples/example-1.json") as { input: unknown };
    const r = validate(example.input, raisePipelineManifest.inputSchema);
    expect(r.valid).toBe(true);
  });
});
