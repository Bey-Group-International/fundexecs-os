// Golden tests for the market-map deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { marketMap, marketMapManifest, type MarketMapInput } from "./market-map";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "research" };
const run = (input: MarketMapInput) => marketMap.run(input, ctx);

describe("market-map core", () => {
  it("groups a provided company set by segment and counts each", () => {
    const r = run({
      sector: "Payments",
      geography: "North America",
      companies: [
        { name: "Alpha", segment: "Acquiring" },
        { name: "Beta", segment: "Issuing" },
        { name: "Gamma", segment: "Acquiring" },
        { name: "Delta", segment: "Acquiring" },
      ],
    });
    expect(r.structured.totalCompanies).toBe(4);
    expect(r.structured.segmentCount).toBe(2);
    const acquiring = r.structured.segments.find((s) => s.segment === "Acquiring")!;
    expect(acquiring.count).toBe(3);
    expect(acquiring.companies).toEqual(["Alpha", "Gamma", "Delta"]);
    // Segments are a calculation over the provided set, never researched facts.
    expect(r.sources.find((s) => s.label === "Segment grouping")?.kind).toBe("calculation");
  });

  it("sorts segments by count descending", () => {
    const r = run({
      sector: "SaaS",
      companies: [
        { name: "A", segment: "Small" },
        { name: "B", segment: "Big" },
        { name: "C", segment: "Big" },
        { name: "D", segment: "Big" },
        { name: "E", segment: "Mid" },
        { name: "F", segment: "Mid" },
      ],
    });
    expect(r.structured.segments.map((s) => s.segment)).toEqual(["Big", "Mid", "Small"]);
    expect(r.structured.segments.map((s) => s.count)).toEqual([3, 2, 1]);
  });

  it("records each provided company name as a FACT, never researching or inventing", () => {
    const r = run({ sector: "Fintech", companies: [{ name: "OnlyCo", segment: "Lending" }] });
    const facts = r.sources.filter((s) => s.kind === "fact");
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toBe("OnlyCo");
    // No assumption or generated claim manufactures a company.
    expect(r.sources.some((s) => s.kind === "assumption")).toBe(false);
  });

  it("buckets companies with no segment under Unsegmented and flags them", () => {
    const r = run({
      sector: "Logistics",
      companies: [
        { name: "Segd", segment: "Freight" },
        { name: "Loose1" },
        { name: "Loose2" },
      ],
    });
    expect(r.structured.unsegmented).toEqual(["Loose1", "Loose2"]);
    const unseg = r.structured.segments.find((s) => s.segment === "Unsegmented")!;
    expect(unseg.count).toBe(2);
    expect(r.structured.missingContext.some((m) => /no segment/i.test(m))).toBe(true);
  });

  it("returns an empty map for an empty company set and NEVER fabricates companies", () => {
    const r = run({ sector: "Insurtech", geography: "EU", companies: [] });
    expect(r.structured.segments).toEqual([]);
    expect(r.structured.totalCompanies).toBe(0);
    expect(r.structured.segmentCount).toBe(0);
    expect(r.structured.missingContext).toContain(
      "No companies supplied — this skill maps a provided company set; it does not research or fabricate companies.",
    );
    expect(r.sources.some((s) => s.kind === "fact")).toBe(false);
    expect(r.completeness).toBe(0);
  });

  it("treats a missing companies field the same as an empty set", () => {
    const r = run({ sector: "Insurtech" });
    expect(r.structured.totalCompanies).toBe(0);
    expect(r.structured.missingContext).toContain(
      "No companies supplied — this skill maps a provided company set; it does not research or fabricate companies.",
    );
  });

  it("flags a missing geography as context, not as an invented value", () => {
    const r = run({ sector: "Payments", companies: [{ name: "A", segment: "X" }] });
    expect(r.structured.missingContext.some((m) => /Geography not provided/i.test(m))).toBe(true);
  });

  it("is fully deterministic — same input, identical output", () => {
    const input: MarketMapInput = {
      sector: "Payments",
      companies: [
        { name: "A", segment: "One" },
        { name: "B", segment: "Two" },
        { name: "C", segment: "One" },
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

describe("market-map package consistency", () => {
  const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/market-map/input.schema.json")).toEqual(marketMapManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/market-map/output.schema.json")).toEqual(marketMapManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/market-map/examples/example-1.json") as { input: unknown };
    const res = validate(example.input, marketMapManifest.inputSchema);
    expect(res.valid).toBe(true);
  });
});
