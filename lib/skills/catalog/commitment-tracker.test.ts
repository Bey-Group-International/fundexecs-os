// Golden tests for the commitment-tracker deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { commitmentTracker, commitmentTrackerManifest, type CommitmentTrackerInput } from "./commitment-tracker";
import type { SkillContext } from "@/lib/skills/types";

const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "capital_formation" };
const run = (input: CommitmentTrackerInput) => commitmentTracker.run(input, ctx);

describe("commitment-tracker core", () => {
  it("rolls up a supplied commitment set with per-investor allocation %, sorted by amount desc", () => {
    const r = run({
      targetClose: 100,
      commitments: [
        { investor: "Beta LP", amount: 25, status: "committed" },
        { investor: "Alpha LP", amount: 50, status: "signed" },
        { investor: "Gamma LP", amount: 25, status: "soft_circle" },
      ],
    });
    expect(r.structured.totalInvestors).toBe(3);
    expect(r.structured.totalCommitted).toBe(100);
    // signed/funded only.
    expect(r.structured.bindingCommitted).toBe(50);
    // Sorted by amount desc.
    expect(r.structured.byInvestor[0].investor).toBe("Alpha LP");
    expect(r.structured.byInvestor[0].pctOfTotal).toBe(50);
    expect(r.structured.byInvestor[1].pctOfTotal).toBe(25);
    // Target roll-up.
    expect(r.structured.remainingToTarget).toBe(0);
    expect(r.structured.pctOfTarget).toBe(100);
    expect(r.structured.overSubscribed).toBe(false);
  });

  it("labels a supplied amount as a fact and totalCommitted as a calculation", () => {
    const r = run({ commitments: [{ investor: "Alpha LP", amount: 40, status: "committed" }] });
    // Supplied amount is a FACT.
    expect(r.sources.find((s) => s.label === "Alpha LP — commitment amount")?.kind).toBe("fact");
    // totalCommitted is a CALCULATION, never a fact.
    expect(r.sources.find((s) => s.label === "Total committed")?.kind).toBe("calculation");
  });

  it("GUARDRAIL: empty commitment set returns an empty roll-up and never invents commitments", () => {
    const r = run({ targetClose: 100, commitments: [] });
    expect(r.structured.byInvestor).toEqual([]);
    expect(r.structured.totalCommitted).toBe(0);
    expect(r.structured.bindingCommitted).toBe(0);
    expect(r.structured.totalInvestors).toBe(0);
    expect(r.structured.missingContext).toContain(
      "No commitments supplied — this skill tracks a provided commitment set; it does not fabricate commitments.",
    );
    // Nothing fabricated: no fact source carries any commitment value.
    expect(r.sources.length).toBe(0);
  });

  it("treats a missing commitments field the same as an empty set", () => {
    const r = run({});
    expect(r.structured.byInvestor).toEqual([]);
    expect(r.structured.totalInvestors).toBe(0);
    expect(r.structured.missingContext[0]).toContain("does not fabricate commitments");
  });

  it("counts a commitment with no amount but flags it and excludes it from totals — never assumes zero", () => {
    const r = run({
      commitments: [
        { investor: "Alpha LP", amount: 60, status: "committed" },
        { investor: "Blind LP", status: "soft_circle" },
      ],
    });
    // Both investors counted.
    expect(r.structured.totalInvestors).toBe(2);
    // Only the supplied amount is summed.
    expect(r.structured.totalCommitted).toBe(60);
    // The missing amount is flagged, not assumed.
    expect(r.structured.missingContext.some((m) => m.includes("amount missing") && m.includes("Blind LP"))).toBe(true);
    // Nothing fabricated: no fact source carries an amount for the blind LP.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Blind LP — commitment amount")).toBe(false);
    // The blind LP carries a null amount, not zero.
    expect(r.structured.byInvestor.find((b) => b.investor === "Blind LP")?.amount).toBeNull();
  });

  it("detects over-subscription past the hard cap and flags it prominently", () => {
    const r = run({
      hardCap: 100,
      commitments: [
        { investor: "Alpha LP", amount: 80, status: "signed" },
        { investor: "Beta LP", amount: 50, status: "committed" },
      ],
    });
    expect(r.structured.overSubscribed).toBe(true);
    expect(r.structured.missingContext.some((m) => m.includes("OVER-SUBSCRIBED"))).toBe(true);
    // Advisory only — never binds or calls capital.
    expect(r.structured.recommendedAction).toMatch(/scale back/i);
    expect(r.structured.recommendedAction).toMatch(/human/i);
  });

  it("returns null remaining-to-target and flags it when no target close is supplied", () => {
    const r = run({ commitments: [{ investor: "Alpha LP", amount: 40, status: "committed" }] });
    expect(r.structured.remainingToTarget).toBeNull();
    expect(r.structured.pctOfTarget).toBeNull();
    expect(r.structured.targetClose).toBeNull();
    expect(r.structured.missingContext.some((m) => m.includes("No target close supplied"))).toBe(true);
  });

  it("never lists a capital-binding action as prohibited-clear — capital_call/move_capital are prohibited", () => {
    expect(commitmentTrackerManifest.prohibitedActions).toEqual(
      expect.arrayContaining(["capital_call", "move_capital", "sign_document", "execute_subdoc"]),
    );
  });

  it("always produces a recommended next action and a narrative", () => {
    const r = run({ commitments: [{ investor: "Alpha LP", amount: 10 }] });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});

describe("commitment-tracker package consistency", () => {
  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/commitment-tracker/input.schema.json")).toEqual(commitmentTrackerManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/commitment-tracker/output.schema.json")).toEqual(commitmentTrackerManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/commitment-tracker/examples/example-1.json") as { input: unknown };
    const r = validate(example.input, commitmentTrackerManifest.inputSchema);
    expect(r.valid).toBe(true);
  });
});
