// Golden tests for the sector-research deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { sectorResearch, sectorResearchManifest, type SectorResearchInput } from "./sector-research";
import type { SkillContext } from "@/lib/skills/types";

const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "research" };
const run = (input: SectorResearchInput) => sectorResearch.run(input, ctx);

describe("sector-research core", () => {
  it("groups supplied findings by category into sections", () => {
    const r = run({
      sector: "Payments",
      findings: [
        { claim: "Real-time rails are expanding", category: "driver", source: "Fed report 2026", sourceType: "primary" },
        { claim: "Interchange caps loom", category: "risk", source: "Reg brief", sourceType: "secondary" },
        { claim: "Embedded finance is accelerating", category: "trend", source: "Analyst note", sourceType: "expert" },
        { claim: "Stripe leads acquiring", category: "player", source: "S-1", sourceType: "primary" },
      ],
    });
    expect(r.structured.sector).toBe("Payments");
    expect(r.structured.sections.map((s) => s.category)).toEqual(["driver", "risk", "trend", "player"]);
    const driver = r.structured.sections.find((s) => s.category === "driver")!;
    expect(driver.findings).toHaveLength(1);
    expect(driver.findings[0].claim).toBe("Real-time rails are expanding");
    expect(r.structured.sourcedCount).toBe(4);
    expect(r.structured.unsourcedCount).toBe(0);
  });

  it("emits a sourced claim as a FACT carrying its source ref", () => {
    const r = run({
      sector: "SaaS",
      findings: [{ claim: "ARR growth is decelerating", category: "trend", source: "10-K 2026", sourceType: "primary" }],
    });
    const fact = r.sources.find((s) => s.kind === "fact");
    expect(fact).toBeDefined();
    expect(fact!.value).toBe("ARR growth is decelerating");
    expect(fact!.ref).toBe("10-K 2026");
    // A sourced claim carries its source in the brief.
    const finding = r.structured.sections[0].findings[0];
    expect(finding.source).toBe("10-K 2026");
    // Nothing generated when every claim is sourced.
    expect(r.sources.some((s) => s.kind === "generated")).toBe(false);
  });

  it("flags an UNSOURCED claim as unsupported and NEVER emits it as a fact", () => {
    const r = run({
      sector: "Insurtech",
      findings: [
        { claim: "Market will double by 2030", category: "sizing" },
        { claim: "Loss ratios improving", category: "driver", source: "Actuarial memo", sourceType: "primary" },
      ],
    });
    expect(r.structured.unsupportedClaims).toEqual(["Market will double by 2030"]);
    expect(r.structured.unsourcedCount).toBe(1);
    expect(r.structured.sourcedCount).toBe(1);
    // The unsupported claim is surfaced in the brief with a null source and D grade.
    const sizing = r.structured.sections.find((s) => s.category === "sizing")!;
    expect(sizing.findings[0].source).toBeNull();
    expect(sizing.findings[0].grade).toBe("D");
    // It is emitted as a GENERATED item, never a fact — and no source is invented.
    const unsupported = r.sources.find((s) => s.value === "Market will double by 2030");
    expect(unsupported!.kind).toBe("generated");
    expect(unsupported!.ref).toBeUndefined();
    expect(r.sources.some((s) => s.kind === "fact" && s.value === "Market will double by 2030")).toBe(false);
    expect(r.structured.recommendedAction).toMatch(/lack a source/i);
  });

  it("grades source quality by sourceType", () => {
    const r = run({
      sector: "Logistics",
      findings: [
        { claim: "primary claim", category: "driver", source: "s1", sourceType: "primary" },
        { claim: "expert claim", category: "driver", source: "s2", sourceType: "expert" },
        { claim: "secondary claim", category: "risk", source: "s3", sourceType: "secondary" },
        { claim: "news claim", category: "trend", source: "s4", sourceType: "news" },
        { claim: "unknown-type claim", category: "player", source: "s5", sourceType: "unknown" },
        { claim: "no-type claim", category: "sizing", source: "s6" },
      ],
    });
    const gradeOf = (claim: string) =>
      r.structured.sections.flatMap((s) => s.findings).find((f) => f.claim === claim)!.grade;
    expect(gradeOf("primary claim")).toBe("A");
    expect(gradeOf("expert claim")).toBe("B");
    expect(gradeOf("secondary claim")).toBe("C");
    expect(gradeOf("news claim")).toBe("C");
    expect(gradeOf("unknown-type claim")).toBe("D");
    expect(gradeOf("no-type claim")).toBe("D");
    // Overall source quality is a CALCULATION, never a fact.
    expect(r.sources.find((s) => s.label === "Source quality")?.kind).toBe("calculation");
    expect(r.structured.sourceQuality).toContain("A:1");
  });

  it("returns an empty brief for an empty finding set and NEVER fabricates market data", () => {
    const r = run({ sector: "Space Economy", findings: [] });
    expect(r.structured.sections).toEqual([]);
    expect(r.structured.sourcedCount).toBe(0);
    expect(r.structured.unsourcedCount).toBe(0);
    expect(r.structured.unsupportedClaims).toEqual([]);
    expect(r.structured.missingContext).toContain(
      "No findings supplied — this skill organizes provided research; it does not fabricate market data.",
    );
    expect(r.sources.some((s) => s.kind === "fact")).toBe(false);
    expect(r.completeness).toBe(0);
  });

  it("treats a missing findings field the same as an empty set", () => {
    const r = run({ sector: "Space Economy" });
    expect(r.structured.sections).toEqual([]);
    expect(r.structured.sourcedCount).toBe(0);
    expect(r.structured.missingContext[0]).toContain("does not fabricate market data");
  });

  it("is fully deterministic — same input, identical output", () => {
    const input: SectorResearchInput = {
      sector: "Payments",
      findings: [
        { claim: "one", category: "driver", source: "a", sourceType: "primary" },
        { claim: "two", category: "risk" },
        { claim: "three", category: "driver", source: "b", sourceType: "news" },
      ],
    };
    expect(JSON.stringify(run(input).structured)).toBe(JSON.stringify(run(input).structured));
  });

  it("always produces a narrative and a recommended action", () => {
    const r = run({ sector: "X" });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});

describe("sector-research package consistency", () => {
  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/sector-research/input.schema.json")).toEqual(sectorResearchManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/sector-research/output.schema.json")).toEqual(sectorResearchManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/sector-research/examples/example-1.json") as { input: unknown };
    const res = validate(example.input, sectorResearchManifest.inputSchema);
    expect(res.valid).toBe(true);
  });
});
