// Golden tests for the capital-call deterministic core. The core PREPARES a
// capital call notice DRAFT; it never MOVES capital and never SENDS. A missing
// input becomes an open item — never a fabricated figure — and the wiring
// section is ALWAYS an open placeholder.
import { readFileSync } from "fs";
import { join } from "path";
import { capitalCall, capitalCallManifest, type CapitalCallInput } from "./capital-call";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "investor_relations" };
const run = (input: CapitalCallInput) => capitalCall.run(input, ctx);

const HEADINGS = ["Header", "Amount Due", "Due Date", "Purpose", "Wiring Instructions"];

const wiring = (input: CapitalCallInput) =>
  run(input).structured.sections.find((s) => s.heading === "Wiring Instructions");

describe("capital-call core", () => {
  it("assembles the five notice sections in the fixed order", () => {
    const r = run({ fundName: "Fund I" });
    expect(r.structured.sections.map((s) => s.heading)).toEqual(HEADINGS);
  });

  it("uses an explicitly provided call amount as a FACT", () => {
    const r = run({ fundName: "Fund I", investorName: "LP One", callNumber: 3, callAmount: 250000, dueDate: "2026-08-01", purpose: "Fund a new acquisition." });
    expect(r.structured.callAmount).toBe(250000);
    expect(r.sources.find((s) => s.label === "Call amount")?.kind).toBe("fact");
    const amount = r.structured.sections.find((s) => s.heading === "Amount Due");
    expect(amount?.status).toBe("complete");
  });

  it("derives the call amount from commitment × percent as a CALCULATION", () => {
    const r = run({ fundName: "Fund I", totalCommitment: 1000000, callPercent: 25 });
    expect(r.structured.callAmount).toBe(250000); // 1,000,000 × 25 / 100
    expect(r.sources.find((s) => s.label === "Call amount")?.kind).toBe("calculation");
  });

  it("rounds a derived call amount to two decimals", () => {
    const r = run({ fundName: "Fund I", totalCommitment: 1000, callPercent: 33.333 });
    expect(r.structured.callAmount).toBe(333.33); // 333.33 rounded
  });

  it("prefers an explicit callAmount over the derivable figure", () => {
    const r = run({ fundName: "Fund I", totalCommitment: 1000000, callPercent: 25, callAmount: 300000 });
    expect(r.structured.callAmount).toBe(300000);
    expect(r.sources.find((s) => s.label === "Call amount")?.kind).toBe("fact");
  });

  it("FLAGS a missing amount instead of inventing one", () => {
    const r = run({ fundName: "Fund I" });
    expect(r.structured.callAmount).toBeNull();
    const amount = r.structured.sections.find((s) => s.heading === "Amount Due");
    expect(amount?.status).toBe("open");
    expect(r.structured.missingFields.length).toBeGreaterThan(0);
    // Nothing fabricated: no fact/calculation source carries a call amount.
    expect(r.sources.some((s) => s.label === "Call amount")).toBe(false);
  });

  it("does not derive an amount from a partial commitment/percent pair", () => {
    const onlyCommitment = run({ fundName: "Fund I", totalCommitment: 1000000 });
    expect(onlyCommitment.structured.callAmount).toBeNull();
    const onlyPercent = run({ fundName: "Fund I", callPercent: 25 });
    expect(onlyPercent.structured.callAmount).toBeNull();
  });

  it("ALWAYS keeps Wiring Instructions open with the non-fabrication placeholder", () => {
    // Even a fully-populated input never fills wiring.
    const full = wiring({ fundName: "Fund I", investorName: "LP One", callNumber: 1, callAmount: 100000, dueDate: "2026-08-01", purpose: "Acquisition." });
    expect(full?.status).toBe("open");
    expect(full?.body).toBe("Placeholder — wiring details must be supplied by fund admin; never auto-populated.");
    // And the bare case too.
    expect(wiring({ fundName: "Fund I" })?.status).toBe("open");
  });

  it("never weaves the wiring placeholder into the assembled notice draft", () => {
    const r = run({ fundName: "Fund I", callAmount: 100000, dueDate: "2026-08-01", purpose: "Acquisition." });
    expect(r.structured.noticeDraft.body).not.toContain("Wiring");
    expect(r.structured.noticeDraft.body).not.toContain("wiring details must be supplied");
    // The draft heading identifies the fund.
    expect(r.structured.noticeDraft.heading).toContain("Fund I");
  });

  it("flags a missing due date with the pending placeholder, never a guessed date", () => {
    const r = run({ fundName: "Fund I", callAmount: 100000 });
    const dd = r.structured.sections.find((s) => s.heading === "Due Date");
    expect(dd?.status).toBe("open");
    expect(dd?.body).toBe("Pending — confirm due date");
    expect(r.structured.openItems).toEqual(expect.arrayContaining([expect.stringMatching(/Due date pending/)]));
  });

  it("flags a missing purpose as an open item", () => {
    const r = run({ fundName: "Fund I", callAmount: 100000 });
    const p = r.structured.sections.find((s) => s.heading === "Purpose");
    expect(p?.status).toBe("open");
    expect(r.structured.openItems).toEqual(expect.arrayContaining([expect.stringMatching(/Purpose pending/)]));
  });

  it("PREPARES, never EXECUTES: recommendedAction stresses draft-only + Tier-3 human authorization", () => {
    const r = run({ fundName: "Fund I", callAmount: 100000, dueDate: "2026-08-01", purpose: "Acquisition." });
    expect(r.structured.recommendedAction).toMatch(/DRAFT/);
    expect(r.structured.recommendedAction).toMatch(/never moves capital/i);
    expect(r.structured.recommendedAction).toMatch(/Tier-3/);
    expect(r.structured.recommendedAction).toMatch(/human authorization/i);
  });

  it("the narrative states it prepares a draft and never sends or moves capital", () => {
    const r = run({ fundName: "Fund I" });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.narrative).toMatch(/never moves capital/i);
    expect(r.narrative).toMatch(/never sends/i);
  });

  it("manifest encodes the guardrails: Tier 1 prepare-only, capital movement/sending prohibited", () => {
    // The DRAFT preparation itself is a Tier-1 internal work product...
    expect(capitalCallManifest.approvalTier).toBe(1);
    expect(capitalCallManifest.riskClassification).toBe("moderate");
    // ...but the capital-binding / sending actions are explicitly prohibited here.
    expect(capitalCallManifest.prohibitedActions).toEqual(
      expect.arrayContaining(["capital_call", "move_capital", "distribute_report", "send_reply", "sign_document"]),
    );
    // A prepare-only leaf: it seeds no downstream skill and uses no tools.
    expect(capitalCallManifest.allowedDownstreamSkills).toEqual([]);
    expect(capitalCallManifest.tools).toEqual([]);
  });
});

// The TypeScript manifest and the on-disk authoring package must never diverge.
function loadJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));
}

describe("capital-call package consistency", () => {
  it("input schema on disk matches the manifest by value", () => {
    expect(loadJson("skills/capital-call/input.schema.json")).toEqual(capitalCallManifest.inputSchema);
  });

  it("output schema on disk matches the manifest by value", () => {
    expect(loadJson("skills/capital-call/output.schema.json")).toEqual(capitalCallManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/capital-call/examples/example-1.json") as { input: unknown };
    const r = validate(example.input, capitalCallManifest.inputSchema);
    expect(r.valid).toBe(true);
  });
});
