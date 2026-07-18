// Golden tests for the lp-update deterministic core. The core PREPARES a DRAFT
// quarterly LP update for review; it never DISTRIBUTES it. A missing performance
// metric becomes an open item ("Pending — confirm from fund admin"), never a
// fabricated figure.
import { lpUpdate, type LpUpdateInput } from "./lp-update";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "investor_relations" };
const run = (input: LpUpdateInput) => lpUpdate.run(input, ctx);

const HEADINGS = ["Summary", "Performance", "Portfolio Highlights", "Capital Activity", "Outlook"];

describe("lp-update core", () => {
  it("assembles all five sections in the fixed order", () => {
    const r = run({ fundName: "Fund I" });
    expect(r.structured.sections.map((s) => s.heading)).toEqual(HEADINGS);
  });

  it("assembles a complete draft from full fund data", () => {
    const r = run({
      fundName: "Meridian Fund II",
      period: "Q2 2026",
      nav: 420,
      dpi: 0.6,
      tvpi: 1.8,
      netIrrPct: 19,
      highlights: ["Portfolio company A closed a Series C", "Two new platform investments"],
      portfolioNotes: "Overall portfolio tracking to plan.",
      capitalActivity: "One capital call of $25m; no distributions this quarter.",
    });
    expect(r.structured.missingFields).toEqual([]);
    expect(r.structured.completeness).toBe(1);
    expect(r.structured.sections.every((s) => s.status === "complete")).toBe(true);
    expect(r.structured.openItems).toEqual([]);
    // All four metrics stated, and each recorded as a FACT.
    expect(r.structured.statedMetrics).toEqual(["NAV", "DPI", "TVPI", "Net IRR"]);
    expect(r.sources.find((s) => s.label === "NAV")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "Net IRR")?.kind).toBe("fact");
  });

  it("PREPARES a draft, never DISTRIBUTES it", () => {
    const r = run({ fundName: "Fund I" });
    const summary = r.structured.sections.find((s) => s.heading === "Summary");
    expect(summary?.body).toMatch(/DRAFT/);
    expect(summary?.body).toMatch(/not distributed to LPs/);
    expect(r.structured.recommendedAction).toMatch(/human sign-off \(Tier 2\)/);
    expect(r.narrative).toMatch(/does not distribute the letter to LPs/);
  });

  it("never fabricates performance metrics — with none provided, Performance is open and pending", () => {
    const r = run({ fundName: "Fund I" });
    const perf = r.structured.sections.find((s) => s.heading === "Performance");
    expect(perf?.status).toBe("open");
    expect(perf?.body).toMatch(/Pending — confirm from fund admin/);
    expect(r.structured.statedMetrics).toEqual([]);
    expect(r.structured.openItems).toEqual(expect.arrayContaining(["Performance metrics pending — confirm from fund admin."]));
    // Nothing invented: no metric appears as a fact source.
    expect(r.sources.some((s) => ["NAV", "DPI", "TVPI", "Net IRR"].includes(s.label))).toBe(false);
  });

  it("lists only the metrics actually provided as stated figures", () => {
    const r = run({ fundName: "Fund I", dpi: 0.5, tvpi: 1.6 });
    const perf = r.structured.sections.find((s) => s.heading === "Performance");
    expect(perf?.status).toBe("complete");
    expect(r.structured.statedMetrics).toEqual(["DPI", "TVPI"]);
    expect(perf?.body).toMatch(/DPI: 0.5x/);
    expect(perf?.body).toMatch(/TVPI: 1.6x/);
    expect(perf?.body).not.toMatch(/NAV/);
    expect(perf?.body).not.toMatch(/Net IRR/);
  });

  it("builds Portfolio Highlights from highlights and/or portfolio notes, else open", () => {
    const withData = run({ fundName: "Fund I", highlights: ["Exit of Company X at 3.2x"] });
    const ph = withData.structured.sections.find((s) => s.heading === "Portfolio Highlights");
    expect(ph?.status).toBe("complete");
    expect(ph?.body).toMatch(/Exit of Company X/);

    const bare = run({ fundName: "Fund I" });
    const phOpen = bare.structured.sections.find((s) => s.heading === "Portfolio Highlights");
    expect(phOpen?.status).toBe("open");
    expect(bare.structured.openItems).toContain("Portfolio Highlights");
  });

  it("builds Capital Activity from capitalActivity, else open", () => {
    const withData = run({ fundName: "Fund I", capitalActivity: "Distribution of $10m in June." });
    const ca = withData.structured.sections.find((s) => s.heading === "Capital Activity");
    expect(ca?.status).toBe("complete");
    expect(ca?.body).toMatch(/Distribution of \$10m/);

    const bare = run({ fundName: "Fund I" });
    const caOpen = bare.structured.sections.find((s) => s.heading === "Capital Activity");
    expect(caOpen?.status).toBe("open");
    expect(bare.structured.openItems).toContain("Capital Activity");
  });

  it("Outlook is a neutral generated placeholder with no forward-looking commitments", () => {
    const r = run({ fundName: "Fund I" });
    const outlook = r.structured.sections.find((s) => s.heading === "Outlook");
    expect(outlook?.status).toBe("complete");
    expect(outlook?.body).toMatch(/no forward-looking performance commitments/);
    expect(r.sources.find((s) => s.label === "Outlook")?.kind).toBe("generated");
  });

  it("completeness reflects the fraction of complete sections on a bare input", () => {
    const r = run({ fundName: "Fund I" });
    // Only Summary and Outlook are complete on a bare input → 2/5.
    expect(r.structured.completeness).toBeCloseTo(2 / 5, 2);
    expect(r.structured.missingFields).toEqual(
      expect.arrayContaining(["Period", "NAV", "DPI", "TVPI", "Net IRR", "Portfolio highlights", "Capital activity"]),
    );
    expect(r.missingData).toEqual(r.structured.missingFields);
  });

  it("always produces a narrative that states it prepares a draft, not distributes", () => {
    const r = run({ fundName: "Fund I", nav: 100 });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.narrative).toMatch(/DRAFT/);
    expect(r.narrative).toMatch(/does not distribute/);
  });
});
