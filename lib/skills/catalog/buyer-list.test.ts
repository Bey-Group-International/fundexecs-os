// Golden tests for the buyer-list deterministic core.
import { buyerList, NO_BUYERS_MESSAGE, type BuyerListInput } from "./buyer-list";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "deal_sourcer" };
const run = (input: BuyerListInput) => buyerList.run(input, ctx);

describe("buyer-list core", () => {
  it("ranks a supplied buyer set by fitScore descending", () => {
    const r = run({
      company: { name: "TargetCo", sector: "Industrials", geography: "North America" },
      buyers: [
        { name: "OffSector Sponsor", type: "sponsor", sector: "Consumer", geography: "EU" },
        { name: "Perfect Strategic", type: "strategic", sector: "Industrials", geography: "North America" },
        { name: "Capitalized Sponsor", type: "sponsor", sector: "Industrials", geography: "North America", aum: 5000 },
      ],
    });
    const scores = r.structured.ranked.map((b) => b.fitScore);
    // Sorted descending.
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(r.structured.ranked[0].name).toBe("Perfect Strategic");
    expect(r.structured.ranked[0].fitScore).toBe(100);
    expect(r.structured.buyerCount).toBe(3);
  });

  it("returns empty ranked + the guardrail note when NO buyers are supplied (never fabricates)", () => {
    const r = run({ company: { name: "Orphan Co", sector: "Software" } });
    expect(r.structured.ranked).toEqual([]);
    expect(r.structured.topBuyers).toEqual([]);
    expect(r.structured.buyerCount).toBe(0);
    expect(r.structured.missingContext).toContain(NO_BUYERS_MESSAGE);
    // Nothing invented: no buyer facts or fit calculations were produced.
    expect(r.sources.some((s) => s.label.startsWith("Fit score"))).toBe(false);
    expect(r.completeness).toBe(0);
  });

  it("treats an empty buyers array the same as omitted — empty ranking, guardrail note", () => {
    const r = run({ company: { name: "Orphan Co" }, buyers: [] });
    expect(r.structured.ranked).toEqual([]);
    expect(r.structured.missingContext).toContain(NO_BUYERS_MESSAGE);
  });

  it("labels provided fields as facts and each fitScore as a calculation", () => {
    const r = run({
      company: { name: "TargetCo", sector: "Healthcare" },
      buyers: [{ name: "MedStrategic", type: "strategic", sector: "Healthcare" }],
    });
    expect(r.sources.find((s) => s.label === "Company")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "Buyer type — MedStrategic")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "Fit score — MedStrategic")?.kind).toBe("calculation");
  });

  it("counts buyers by type, including untyped as unknown", () => {
    const r = run({
      company: { name: "TargetCo" },
      buyers: [
        { name: "A", type: "strategic" },
        { name: "B", type: "financial", aum: 100 },
        { name: "C", type: "sponsor", aum: 200 },
        { name: "D", type: "sponsor" },
        { name: "E" },
      ],
    });
    expect(r.structured.byType).toEqual({ strategic: 1, financial: 1, sponsor: 2, unknown: 1 });
  });

  it("scores sector/geography mismatch below a full match and records match reasons", () => {
    const r = run({
      company: { name: "TargetCo", sector: "Industrials", geography: "North America" },
      buyers: [
        { name: "Mismatch", type: "strategic", sector: "Consumer", geography: "Asia" },
        { name: "Match", type: "strategic", sector: "Industrials", geography: "North America" },
      ],
    });
    const mismatch = r.structured.ranked.find((b) => b.name === "Mismatch")!;
    const match = r.structured.ranked.find((b) => b.name === "Match")!;
    expect(match.fitScore).toBeGreaterThan(mismatch.fitScore);
    expect(match.matchReasons).toEqual(expect.arrayContaining(["Sector match (Industrials)"]));
    expect(mismatch.matchReasons.some((m) => m.includes("mismatch"))).toBe(true);
  });

  it("caps topBuyers at 5 and preserves supplied rationale", () => {
    const buyers = Array.from({ length: 7 }, (_, i) => ({
      name: `Buyer ${i}`,
      type: "sponsor" as const,
      sector: "Industrials",
      aum: 1000 + i,
      rationale: `Reason ${i}`,
    }));
    const r = run({ company: { name: "TargetCo", sector: "Industrials" }, buyers });
    expect(r.structured.topBuyers.length).toBe(5);
    expect(r.structured.ranked[0].rationale).toMatch(/^Reason /);
  });

  it("flags a buyer with no overlapping attributes rather than inventing a score signal", () => {
    const r = run({
      company: { name: "TargetCo" },
      buyers: [{ name: "Opaque" }],
    });
    expect(r.structured.ranked[0].fitScore).toBe(0);
    expect(r.structured.ranked[0].matchReasons).toContain("Insufficient overlap data to score fit");
    expect(r.structured.missingContext.some((m) => m.includes("no overlapping attributes"))).toBe(true);
  });

  it("always produces a recommended action and a narrative", () => {
    const r = run({ company: { name: "X" }, buyers: [{ name: "B", type: "strategic", sector: "Tech" }] });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});
