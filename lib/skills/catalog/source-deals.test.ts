// Golden tests for the source-deals deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { sourceDeals, sourceDealsManifest, type SourceDealsInput } from "./source-deals";
import type { SkillContext } from "@/lib/skills/types";

const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "deal_sourcer" };
const run = (input: SourceDealsInput) => sourceDeals.run(input, ctx);

describe("source-deals core", () => {
  it("ranks a supplied candidate set by mandate fit, best first", () => {
    const r = run({
      mandate: { sectors: ["software"], geographies: ["north america"], minRevenue: 10, maxRevenue: 100 },
      candidates: [
        { name: "MidFit Co", sector: "Software", geography: "EU", revenue: 40, source: "crm" },
        { name: "BestFit Co", sector: "Software", geography: "North America", revenue: 50, source: "crm" },
        { name: "OffMandate Co", sector: "Retail", geography: "Asia", revenue: 5, source: "crm" },
      ],
    });
    expect(r.structured.candidateCount).toBe(3);
    expect(r.structured.ranked[0].name).toBe("BestFit Co");
    expect(r.structured.ranked[0].fitScore).toBeGreaterThan(r.structured.ranked[1].fitScore);
    expect(r.structured.topTargets[0]).toBe("BestFit Co");
    // fitScore is a CALCULATION, never a fact.
    expect(r.sources.find((s) => s.label === "BestFit Co — fit score")?.kind).toBe("calculation");
    // Provided fields are FACTS.
    expect(r.sources.find((s) => s.label === "BestFit Co — sector")?.kind).toBe("fact");
  });

  it("GUARDRAIL: empty candidate set returns an empty ranking and never invents targets", () => {
    const r = run({ mandate: { sectors: ["software"] }, candidates: [] });
    expect(r.structured.ranked).toEqual([]);
    expect(r.structured.topTargets).toEqual([]);
    expect(r.structured.candidateCount).toBe(0);
    expect(r.structured.missingContext).toContain(
      "No candidates supplied — this skill ranks a provided candidate set; it does not fabricate targets.",
    );
    // Nothing fabricated: no fact source carries any candidate value.
    expect(r.sources.length).toBe(0);
  });

  it("treats a missing candidates field the same as an empty set", () => {
    const r = run({ mandate: { sectors: ["software"] } });
    expect(r.structured.ranked).toEqual([]);
    expect(r.structured.candidateCount).toBe(0);
    expect(r.structured.missingContext[0]).toContain("does not fabricate targets");
  });

  it("excludes candidates that hit a mandate exclusion and ranks them last", () => {
    const r = run({
      mandate: { sectors: ["consumer"], exclusions: ["tobacco"] },
      candidates: [
        { name: "SmokeCo", sector: "Tobacco", source: "broker" },
        { name: "CleanCo", sector: "Consumer", source: "broker" },
      ],
    });
    const excluded = r.structured.ranked.find((c) => c.name === "SmokeCo");
    expect(excluded?.excluded).toBe(true);
    expect(excluded?.fitScore).toBe(0);
    // Excluded is ranked last.
    expect(r.structured.ranked[r.structured.ranked.length - 1].name).toBe("SmokeCo");
    expect(r.structured.excludedCount).toBe(1);
    expect(r.structured.topTargets).not.toContain("SmokeCo");
  });

  it("matches an exclusion appearing in name or source, case-insensitively", () => {
    const r = run({
      mandate: { exclusions: ["Gambling"] },
      candidates: [{ name: "Lucky Casino", sector: "Leisure", source: "gambling-list-2026" }],
    });
    expect(r.structured.ranked[0].excluded).toBe(true);
  });

  it("scores only KNOWN dimensions and flags missing financials without inventing them", () => {
    const r = run({
      mandate: { sectors: ["software"], minRevenue: 10, maxRevenue: 100 },
      candidates: [{ name: "Mystery SaaS", sector: "Software" }],
    });
    // Sector is known (fit), size unknown (no revenue) → averaged over known dims only.
    expect(r.structured.ranked[0].fitScore).toBe(100);
    expect(r.structured.ranked[0].matchReasons).toContain("Sector match");
    expect(r.structured.missingContext.some((m) => m.includes("Financials missing"))).toBe(true);
    // Nothing fabricated: no fact source carries a revenue number.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Mystery SaaS — revenue")).toBe(false);
  });

  it("caps topTargets at 5 non-excluded candidates", () => {
    const candidates = Array.from({ length: 7 }, (_, i) => ({
      name: `Co${i}`,
      sector: "Software",
      geography: "North America",
    }));
    const r = run({ mandate: { sectors: ["software"], geographies: ["north america"] }, candidates });
    expect(r.structured.topTargets.length).toBe(5);
  });

  it("surfaces size partial-band as a distinct reason", () => {
    const r = run({
      mandate: { minRevenue: 10, maxRevenue: 100, minEbitda: 5, maxEbitda: 50 },
      candidates: [{ name: "HalfBand Co", revenue: 40, ebitda: 100 }], // revenue in, ebitda out
    });
    expect(r.structured.ranked[0].matchReasons).toContain("Size partially in band");
    expect(r.structured.ranked[0].fitScore).toBe(50);
  });

  it("always produces a recommended next action and a narrative", () => {
    const r = run({ mandate: {}, candidates: [{ name: "X" }] });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});

describe("source-deals package consistency", () => {
  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/source-deals/input.schema.json")).toEqual(sourceDealsManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/source-deals/output.schema.json")).toEqual(sourceDealsManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/source-deals/examples/example-1.json") as { input: unknown };
    const r = validate(example.input, sourceDealsManifest.inputSchema);
    expect(r.valid).toBe(true);
  });
});
