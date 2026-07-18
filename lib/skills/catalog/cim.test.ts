// Golden tests for the cim deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { cim, cimManifest, type CimInput } from "./cim";
import type { SkillContext } from "@/lib/skills/types";

const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "communications" };
const run = (input: CimInput) => cim.run(input, ctx);

const fullDeal: CimInput = {
  deal: {
    codename: "Project Atlas",
    sector: "Industrial Software",
    description: "A vertical SaaS platform for logistics operators. Rapidly scaling ARR.",
    revenue: 50,
    ebitda: 12,
    growthRate: 35,
    historicalFinancials: [
      { year: 2023, revenue: 30, ebitda: 6 },
      { year: 2024, revenue: 40, ebitda: 9 },
    ],
    products: ["Dispatch automation", "Fleet analytics"],
    management: [
      { name: "Jane Doe", role: "CEO" },
      { name: "John Roe", role: "CFO" },
    ],
    marketNotes: "Large, fragmented logistics software TAM growing double digits.",
    transactionAsk: "Majority recapitalization to fund M&A.",
  },
};

describe("cim core", () => {
  it("assembles a full CIM outline with every section complete", () => {
    const r = run(fullDeal);
    const keys = r.structured.sections.map((s) => s.key);
    expect(keys).toEqual([
      "executiveSummary",
      "companyOverview",
      "marketOverview",
      "productsServices",
      "financialSummary",
      "management",
      "transactionOverview",
    ]);
    expect(r.structured.sections.every((s) => s.status === "complete")).toBe(true);
    expect(r.structured.missingFields).toEqual([]);
    expect(r.completeness).toBe(1);
  });

  it("GUARDRAIL: with no financials supplied, financialSummary is a flagged placeholder and no invented figure is emitted", () => {
    const r = run({ deal: { codename: "Project Bare", sector: "Healthcare", description: "A clinic network." } });
    const fin = r.structured.sections.find((s) => s.key === "financialSummary");
    expect(fin?.status).toBe("placeholder");
    expect(fin?.body).toBe("[Financial summary to be provided]");
    expect(r.structured.missingFields).toContain("financialSummary");
    // Nothing fabricated: no fact source carries an invented revenue/EBITDA number.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Reported revenue")).toBe(false);
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Reported EBITDA")).toBe(false);
    // No numeric financial fact value slipped in anywhere.
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

  it("carries each historical-financials row figure as a fact source", () => {
    const r = run(fullDeal);
    const fy23rev = r.sources.find((s) => s.label === "FY2023 revenue");
    expect(fy23rev?.kind).toBe("fact");
    expect(fy23rev?.value).toBe(30);
    const fy24ebitda = r.sources.find((s) => s.label === "FY2024 EBITDA");
    expect(fy24ebitda?.kind).toBe("fact");
    expect(fy24ebitda?.value).toBe(9);
    // The financial summary body reflects the historical rows.
    const fin = r.structured.sections.find((s) => s.key === "financialSummary");
    expect(fin?.body).toContain("FY2023");
    expect(fin?.body).toContain("FY2024");
  });

  it("labels the standard confidentiality/disclaimer language as generated prose", () => {
    const r = run(fullDeal);
    const conf = r.sources.find((s) => s.label === "Confidentiality language");
    expect(conf?.kind).toBe("generated");
    const summaryFraming = r.sources.find((s) => s.label === "Executive summary framing");
    expect(summaryFraming?.kind).toBe("generated");
  });

  it("anonymizes by default — management names are withheld, roles kept", () => {
    const r = run(fullDeal);
    expect(r.structured.anonymized).toBe(true);
    const mgmt = r.structured.sections.find((s) => s.key === "management");
    expect(mgmt?.status).toBe("complete");
    expect(mgmt?.body).not.toContain("Jane Doe");
    expect(mgmt?.body).not.toContain("John Roe");
    expect(mgmt?.body).toContain("CEO");
    // No management name leaked into the sources either.
    expect(r.sources.some((s) => s.label === "Management name")).toBe(false);
    // With anonymize:false the real names are surfaced.
    const r2 = run({ ...fullDeal, anonymize: false });
    expect(r2.structured.anonymized).toBe(false);
    const mgmt2 = r2.structured.sections.find((s) => s.key === "management");
    expect(mgmt2?.body).toContain("Jane Doe");
  });

  it("always carries the fixed CIM draft disclaimer", () => {
    const r = run(fullDeal);
    expect(r.structured.disclaimer).toContain("DRAFT");
    expect(r.structured.disclaimer.toLowerCase()).toContain("confidential");
    expect(r.structured.disclaimer).toContain("not an");
    expect(r.structured.disclaimer.toLowerCase()).toContain("offer");
    expect(r.structured.disclaimer.toLowerCase()).toContain("unverified");
  });

  it("recommends completing and routing to a human for review before distribution", () => {
    const r = run({ deal: { codename: "Project Thin" } });
    expect(r.structured.recommendedAction).toContain("review");
    expect(r.structured.recommendedAction).toContain("distribution");
    // All seven sections are placeholders here (only a codename supplied).
    expect(r.structured.recommendedAction).toContain("7 placeholder");
  });

  it("flags a missing company overview as a placeholder, never inventing prose", () => {
    const r = run({ deal: { codename: "Project Quiet", revenue: 10 } });
    const overview = r.structured.sections.find((s) => s.key === "companyOverview");
    expect(overview?.status).toBe("placeholder");
    expect(overview?.body).toBe("[Company overview to be provided]");
    expect(r.structured.missingFields).toContain("companyOverview");
  });

  it("always produces a narrative and a recommended action", () => {
    const r = run({ deal: {} });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});

describe("cim package consistency", () => {
  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/cim/input.schema.json")).toEqual(cimManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/cim/output.schema.json")).toEqual(cimManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/cim/examples/example-1.json") as { input: unknown };
    const r = validate(example.input, cimManifest.inputSchema);
    expect(r.valid).toBe(true);
  });

  it("declares Tier 1 / low risk and prohibits every distribution action", () => {
    expect(cimManifest.approvalTier).toBe(1);
    expect(cimManifest.riskClassification).toBe("low");
    for (const a of ["distribute_report", "share_materials", "send_outreach", "sign_document"] as const) {
      expect(cimManifest.prohibitedActions).toContain(a);
    }
  });
});
