// Golden tests for the dd-checklist deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { ddChecklist, ddChecklistManifest, type DdChecklistInput } from "./dd-checklist";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "diligence" };
const run = (input: DdChecklistInput) => ddChecklist.run(input, ctx);

describe("dd-checklist core", () => {
  it("emits all 16 workstreams by default and counts every request", () => {
    const r = run({ deal: { companyName: "Acme Co" } });
    expect(r.structured.workstreams).toHaveLength(16);
    const summed = r.structured.workstreams.reduce((s, w) => s + w.requests.length, 0);
    expect(r.structured.totalRequests).toBe(summed);
    // financial/commercial/legal/tax are structurally high.
    for (const key of ["financial", "commercial", "legal", "tax"]) {
      expect(r.structured.workstreams.find((w) => w.key === key)?.priority).toBe("high");
    }
    // others default to medium.
    expect(r.structured.workstreams.find((w) => w.key === "operational")?.priority).toBe("medium");
  });

  it("labels the base catalog items as generated, never as facts about the company", () => {
    const r = run({ deal: { companyName: "Acme Co" } });
    expect(r.sources.length).toBeGreaterThan(0);
    expect(r.sources.every((s) => s.kind === "generated")).toBe(true);
    expect(r.sources.some((s) => s.kind === "fact")).toBe(false);
  });

  it("tailors software/tech sectors additively and elevates tech + cyber to high", () => {
    const base = run({ deal: { companyName: "NoSector Co" } });
    const r = run({ deal: { companyName: "SaaS Co", sector: "Enterprise SaaS", transactionType: "Buyout", dealSize: 100 } });
    const tech = r.structured.workstreams.find((w) => w.key === "technology")!;
    const cyber = r.structured.workstreams.find((w) => w.key === "cybersecurity")!;
    expect(tech.requests).toContain("Code ownership & open-source license audit");
    expect(cyber.requests).toContain("SOC 2 / security posture review");
    expect(tech.priority).toBe("high");
    expect(cyber.priority).toBe("high");
    // Additive: strictly more requests than the untailored baseline.
    expect(r.structured.totalRequests).toBeGreaterThan(base.structured.totalRequests);
    expect(r.structured.tailoredFor.length).toBeGreaterThan(0);
  });

  it("adds a TSA item to operational for a carve-out and elevates it to high", () => {
    const r = run({ deal: { companyName: "Divested Unit", transactionType: "Carve-out" } });
    const ops = r.structured.workstreams.find((w) => w.key === "operational")!;
    expect(ops.requests).toContain("TSA scope and standalone cost analysis");
    expect(ops.priority).toBe("high");
    expect(r.structured.tailoredFor.some((t) => /carve-out/i.test(t))).toBe(true);
  });

  it("adds regulatory items and elevates regulatory for a regulated sector", () => {
    const r = run({ deal: { companyName: "HealthCo", sector: "Healthcare Services" } });
    const reg = r.structured.workstreams.find((w) => w.key === "regulatory")!;
    expect(reg.priority).toBe("high");
    expect(reg.requests.length).toBeGreaterThan(3);
    expect(r.structured.tailoredFor.some((t) => /regulated/i.test(t))).toBe(true);
  });

  it("flags missing context instead of inventing it", () => {
    const r = run({ deal: { companyName: "Bare Co" } });
    expect(r.structured.tailoredFor).toEqual([]);
    expect(r.structured.missingContext).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Sector not provided"),
        expect.stringContaining("Transaction type not provided"),
        expect.stringContaining("Deal size not provided"),
      ]),
    );
    expect(r.missingData).toEqual(r.structured.missingContext);
    expect(r.completeness).toBe(0);
  });

  it("respects the workstream filter, preserving canonical order", () => {
    const r = run({ deal: { companyName: "Acme Co" }, workstreams: ["legal", "financial", "tax"] });
    // Canonical order is financial, then legal, then tax (not input order).
    expect(r.structured.workstreams.map((w) => w.key)).toEqual(["financial", "legal", "tax"]);
    expect(r.sources).toHaveLength(3);
  });

  it("handles an empty filter match with a clear recommended action", () => {
    const r = run({ deal: { companyName: "Acme Co" }, workstreams: ["does_not_exist"] });
    expect(r.structured.workstreams).toEqual([]);
    expect(r.structured.totalRequests).toBe(0);
    expect(r.structured.recommendedAction).toMatch(/No matching workstreams/i);
  });

  it("is fully deterministic — same input, identical output", () => {
    const input: DdChecklistInput = { deal: { companyName: "Repeat Co", sector: "SaaS", transactionType: "Carve-out", dealSize: 50 } };
    expect(JSON.stringify(run(input).structured)).toBe(JSON.stringify(run(input).structured));
  });

  it("always produces a narrative and a recommended action", () => {
    const r = run({ deal: { companyName: "X" } });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});

describe("dd-checklist package consistency", () => {
  const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/dd-checklist/input.schema.json")).toEqual(ddChecklistManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/dd-checklist/output.schema.json")).toEqual(ddChecklistManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/dd-checklist/examples/example-1.json") as { input: unknown };
    const res = validate(example.input, ddChecklistManifest.inputSchema);
    expect(res.valid).toBe(true);
  });
});
