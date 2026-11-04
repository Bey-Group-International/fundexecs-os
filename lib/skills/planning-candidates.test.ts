import { candidatesFromEntities, loadPlanningCandidates, MAX_PLANNING_CANDIDATES } from "./planning-candidates";
import { planSkillForStep } from "./skill-planner";
import { executeSkillCore } from "./runner";
import { parseMandateTests } from "@/lib/pe/mandate-tests";

const row = (over: Record<string, unknown> = {}) => ({ name: "Acme", categories: ["software", "fintech"], geography: "UK", metadata: {}, provenance: "manual", ...over }) as never;

describe("candidatesFromEntities", () => {
  it("forwards only what a row carries and never invents a number", () => {
    const [c] = candidatesFromEntities([row({ metadata: { revenue: 40, ebitda: "12", note: "x" } })]);
    expect(c).toEqual({ name: "Acme", sector: "software / fintech", geography: "UK", revenue: 40, source: "manual" }); // string ebitda is not a number -> dropped
  });

  it("drops nameless rows, de-duplicates by name, tolerates junk metadata, and caps the list", () => {
    const rows = [row({ name: "  " }), row({ name: null }), row(), row({ name: "acme" }), row({ name: "B", metadata: [1, 2] }), row({ name: "C", categories: null, geography: "  " })];
    expect(candidatesFromEntities(rows).map((c) => c.name)).toEqual(["Acme", "B", "C"]);
    expect(candidatesFromEntities(rows)[2]).toEqual({ name: "C", source: "manual" });
    const many = Array.from({ length: 80 }, (_, i) => row({ name: `Co ${i}` }));
    expect(candidatesFromEntities(many)).toHaveLength(MAX_PLANNING_CANDIDATES);
    expect(candidatesFromEntities(null)).toEqual([]);
  });
});

describe("loadPlanningCandidates", () => {
  it("queries the org's company entities and degrades to [] on failure", async () => {
    const calls: Array<[string, string]> = [];
    const chain = {
      from: () => chain,
      select: () => chain,
      eq: (c: string, v: string) => (calls.push([c, v]), chain),
      order: () => chain,
      limit: async () => ({ data: [row()] }),
    };
    expect((await loadPlanningCandidates(chain, "org1")).map((c) => c.name)).toEqual(["Acme"]);
    expect(calls).toEqual([["organization_id", "org1"], ["kind", "company"]]);
    expect(await loadPlanningCandidates({ from: () => { throw new Error("boom"); } }, "org1")).toEqual([]);
  });
});

describe("catalog candidates through the planner and the governed runtime", () => {
  const mandate = parseMandateTests({
    status: "approved",
    hardLimits: [{ id: "geo", label: "Geography", metric: "geography", allow: ["UK"], source: "LPA 9.1" }],
    preferences: [{ id: "e", label: "EBITDA", metric: "ebitda", strong: { min: 5 }, weight: 1 }],
    killFacts: [],
  })!;
  const candidates = candidatesFromEntities([row({ name: "Fits", metadata: { ebitda: 9 } }), row({ name: "Wrong geo", geography: "France", metadata: { ebitda: 9 } }), row({ name: "No data", geography: null })]);

  it("target-screen ranks the catalog and leaves unknown fields as needs-data", () => {
    const plan = planSkillForStep("Target screening of the catalog", "", { mandateTests: mandate, candidates })!;
    expect(plan.skillId).toBe("target-screen");
    const r = executeSkillCore(plan.skillId, plan.input, { workspaceId: "o", principalId: "p", executive: plan.executive });
    expect(r.ok).toBe(true);
    const results = (r.structured as { results: Array<{ name: string; result: string }> }).results;
    expect(results.map((x) => [x.name, x.result])).toEqual([["Fits", "pass"], ["No data", "needs-data"], ["Wrong geo", "fail"]]);
  });

  it("source-deals now has a real candidate set to rank", () => {
    const plan = planSkillForStep("Source targets for the mandate", "", { criteria: { geographies: ["UK"] }, candidates })!;
    expect(plan.skillId).toBe("source-deals");
    expect((plan.input as { candidates: unknown[] }).candidates).toHaveLength(3);
    expect(executeSkillCore(plan.skillId, plan.input, { workspaceId: "o", principalId: "p", executive: plan.executive }).ok).toBe(true);
  });
});
