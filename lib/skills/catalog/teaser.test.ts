// Golden tests for the teaser deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { teaser, teaserManifest, type TeaserInput } from "./teaser";
import type { SkillContext } from "@/lib/skills/types";

const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "communications" };
const run = (input: TeaserInput) => teaser.run(input, ctx);

const fullDeal: TeaserInput = {
  deal: {
    codename: "Project Atlas",
    sector: "Industrial Software",
    geography: "North America",
    description: "A vertical SaaS platform for logistics operators. Rapidly scaling ARR.",
    revenue: 50,
    ebitda: 12,
    growthRate: 35,
    askType: "majority",
    investmentHighlights: ["Sticky enterprise base", "Category-leading NRR"],
    useOfProceeds: "Fund M&A and international expansion",
  },
};

describe("teaser core", () => {
  it("assembles a full teaser with every section complete", () => {
    const r = run(fullDeal);
    const keys = r.structured.sections.map((s) => s.key);
    expect(keys).toEqual(["headline", "businessOverview", "financialHighlights", "investmentHighlights", "process"]);
    expect(r.structured.sections.every((s) => s.status === "complete")).toBe(true);
    expect(r.structured.missingFields).toEqual([]);
    expect(r.completeness).toBe(1);
  });

  it("GUARDRAIL: with no revenue/EBITDA supplied, financial highlights is a flagged placeholder and no invented figure is emitted", () => {
    const r = run({ deal: { codename: "Project Bare", sector: "Healthcare" } });
    const fin = r.structured.sections.find((s) => s.key === "financialHighlights");
    expect(fin?.status).toBe("placeholder");
    expect(fin?.body).toBe("[Financials to be provided]");
    expect(r.structured.missingFields).toContain("financialHighlights");
    // Nothing fabricated: no fact source carries an invented revenue/EBITDA number.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Reported revenue")).toBe(false);
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Reported EBITDA")).toBe(false);
    // No numeric fact value slipped in anywhere.
    expect(r.sources.some((s) => s.kind === "fact" && typeof s.value === "number")).toBe(false);
  });

  it("carries a supplied revenue figure as a fact source", () => {
    const r = run(fullDeal);
    const rev = r.sources.find((s) => s.label === "Reported revenue");
    expect(rev?.kind).toBe("fact");
    expect(rev?.value).toBe(50);
    const ebitda = r.sources.find((s) => s.label === "Reported EBITDA");
    expect(ebitda?.kind).toBe("fact");
    expect(ebitda?.value).toBe(12);
  });

  it("labels the process line as generated connective prose", () => {
    const r = run(fullDeal);
    const proc = r.sources.find((s) => s.label === "Process line");
    expect(proc?.kind).toBe("generated");
    const processSection = r.structured.sections.find((s) => s.key === "process");
    expect(processSection?.status).toBe("complete");
    expect(processSection?.body).toContain("under NDA");
  });

  it("anonymizes by default — names the deal by codename only", () => {
    const r = run(fullDeal);
    expect(r.structured.anonymized).toBe(true);
    const headline = r.structured.sections.find((s) => s.key === "headline");
    expect(headline?.body).toContain("Project Atlas");
    // anonymize:false is reflected in the output flag.
    const r2 = run({ ...fullDeal, anonymize: false });
    expect(r2.structured.anonymized).toBe(false);
  });

  it("always carries the fixed draft disclaimer", () => {
    const r = run(fullDeal);
    expect(r.structured.disclaimer).toContain("DRAFT");
    expect(r.structured.disclaimer).toContain("not an");
    expect(r.structured.disclaimer.toLowerCase()).toContain("offer");
    expect(r.structured.disclaimer.toLowerCase()).toContain("unverified");
  });

  it("recommends completing and routing to a human for review before distribution", () => {
    const r = run({ deal: { codename: "Project Thin" } });
    expect(r.structured.recommendedAction).toContain("review");
    expect(r.structured.recommendedAction).toContain("distribution");
    // N placeholder count is surfaced (headline is complete here, the other three are placeholders).
    expect(r.structured.recommendedAction).toContain("3 placeholder");
  });

  it("flags a missing business overview as a placeholder, never inventing prose", () => {
    const r = run({ deal: { codename: "Project Quiet", revenue: 10 } });
    const overview = r.structured.sections.find((s) => s.key === "businessOverview");
    expect(overview?.status).toBe("placeholder");
    expect(overview?.body).toBe("[Business overview to be provided]");
    expect(r.structured.missingFields).toContain("businessOverview");
  });

  it("always produces a narrative and a recommended action", () => {
    const r = run({ deal: {} });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});

describe("teaser package consistency", () => {
  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/teaser/input.schema.json")).toEqual(teaserManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/teaser/output.schema.json")).toEqual(teaserManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/teaser/examples/example-1.json") as { input: unknown };
    const r = validate(example.input, teaserManifest.inputSchema);
    expect(r.valid).toBe(true);
  });

  it("declares Tier 1 / low risk and prohibits every distribution action", () => {
    expect(teaserManifest.approvalTier).toBe(1);
    expect(teaserManifest.riskClassification).toBe("low");
    for (const a of ["distribute_report", "share_materials", "send_outreach", "sign_document"] as const) {
      expect(teaserManifest.prohibitedActions).toContain(a);
    }
  });
});
