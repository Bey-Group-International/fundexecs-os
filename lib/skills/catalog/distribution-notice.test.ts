// Golden tests for the distribution-notice deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { distributionNotice, distributionNoticeManifest, type DistributionNoticeInput } from "./distribution-notice";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "investor_relations" };
const run = (input: DistributionNoticeInput) => distributionNotice.run(input, ctx);

const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

describe("distribution-notice core", () => {
  it("assembles all six sections in order for a fully-specified distribution", () => {
    const r = run({
      fundName: "Meridian Growth Fund II",
      investorName: "Cedar LP",
      distributionNumber: 3,
      distributionAmount: 1_250_000,
      distributionType: "profit",
      recordDate: "2026-06-30",
      paymentDate: "2026-07-15",
      sourceProceeds: "Partial realization of Portfolio Co. A",
    });
    expect(r.structured.sections.map((s) => s.heading)).toEqual([
      "Header",
      "Amount",
      "Type",
      "Record Date",
      "Payment Date",
      "Source of Proceeds",
    ]);
    expect(r.structured.sections.every((s) => s.status === "complete")).toBe(true);
    expect(r.structured.openItems).toEqual([]);
    expect(r.structured.missingFields).toEqual([]);
    expect(r.structured.noticeDraft.heading).toContain("DRAFT");
    expect(r.structured.noticeDraft.heading).toContain("Meridian Growth Fund II");
  });

  it("prepares a DRAFT only and never authorizes moving capital or sending", () => {
    const r = run({ fundName: "Meridian Growth Fund II", distributionAmount: 500_000 });
    expect(r.structured.recommendedAction).toContain("DRAFT");
    expect(r.structured.recommendedAction).toMatch(/Tier-3/);
    // The manifest forbids capital movement and sending, even to prepare.
    expect(distributionNoticeManifest.prohibitedActions).toEqual(
      expect.arrayContaining(["move_capital", "distribute_report", "send_reply", "sign_document"]),
    );
    expect(distributionNoticeManifest.tools).toEqual([]);
    expect(distributionNoticeManifest.allowedDownstreamSkills).toEqual([]);
  });

  it("flags missing distributionAmount instead of inventing it", () => {
    const r = run({ fundName: "Meridian Growth Fund II" });
    expect(r.structured.missingFields).toContain("distributionAmount");
    // No fabricated amount: no fact source carries a distribution amount.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Distribution amount")).toBe(false);
    const amount = r.structured.sections.find((s) => s.heading === "Amount");
    expect(amount?.status).toBe("open");
    // The draft body must not contain any invented amount for the open section.
    expect(r.structured.noticeDraft.body).not.toContain("Distribution amount:");
  });

  it("flags a missing fund name as a missing required field", () => {
    const r = run({ fundName: "", distributionAmount: 100 });
    expect(r.structured.missingFields).toContain("fundName");
    expect(r.structured.sections.find((s) => s.heading === "Header")?.status).toBe("open");
  });

  it("never fabricates dates — missing record/payment dates become open items", () => {
    const r = run({ fundName: "Aster Fund", distributionAmount: 250, distributionType: "dividend" });
    expect(r.structured.openItems).toEqual(expect.arrayContaining(["Record Date", "Payment Date", "Source of Proceeds"]));
    expect(r.sources.some((s) => s.label === "Record date")).toBe(false);
    expect(r.sources.some((s) => s.label === "Payment date")).toBe(false);
  });

  it("marks an unspecified type as pending — confirm classification", () => {
    const r = run({ fundName: "Aster Fund", distributionAmount: 250 });
    const type = r.structured.sections.find((s) => s.heading === "Type");
    expect(type?.status).toBe("open");
    expect(type?.body).toContain("Pending — confirm classification");
  });

  it("records provided figures as facts, never as calculations", () => {
    const r = run({ fundName: "Aster Fund", distributionAmount: 999, distributionType: "return_of_capital" });
    expect(r.sources.find((s) => s.label === "Distribution amount")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "Distribution type")?.kind).toBe("fact");
  });

  it("always produces a recommended action and a narrative", () => {
    const r = run({ fundName: "X", distributionAmount: 1 });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});

describe("distribution-notice package consistency", () => {
  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/distribution-notice/input.schema.json")).toEqual(distributionNoticeManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/distribution-notice/output.schema.json")).toEqual(distributionNoticeManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/distribution-notice/examples/example-1.json") as { input: unknown };
    const r = validate(example.input, distributionNoticeManifest.inputSchema);
    expect(r.valid).toBe(true);
  });

  it("manifest is Tier-1 preparation, moderate risk, execute hub, IR executive", () => {
    expect(distributionNoticeManifest.approvalTier).toBe(1);
    expect(distributionNoticeManifest.riskClassification).toBe("moderate");
    expect(distributionNoticeManifest.hub).toBe("execute");
    expect(distributionNoticeManifest.applicableExecutives).toEqual(["investor_relations"]);
  });
});
