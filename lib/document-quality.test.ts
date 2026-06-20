// lib/document-quality.test.ts
import { scoreDocument, guidanceText, sectionGuidance } from "@/lib/document-quality";

describe("guidanceText", () => {
  it("returns section guidance and the marketing set for exec summaries", () => {
    expect(guidanceText("Strategy memo", "thesis")).toMatch(/market opportunity/i);
    expect(guidanceText("Executive Summary", "overview")).toMatch(/executive summary|collateral/i);
  });
});

describe("scoreDocument", () => {
  it("flags an empty document", () => {
    const r = scoreDocument("Doc", "thesis", "");
    expect(r.level).toBe("Empty");
    expect(r.score).toBe(0);
  });

  it("scores a thin draft as Draft with gaps", () => {
    const r = scoreDocument("Doc", "thesis", "We invest.");
    expect(r.level).toBe("Draft");
    expect(r.gaps.length).toBeGreaterThan(0);
  });

  it("rewards a structured, quantified, on-topic thesis as Institutional", () => {
    const content = [
      "## Market",
      "The lower-middle market is fragmented.",
      "## Strategy",
      "We pursue control buyouts of founder-owned industrials.",
      "## Edge",
      "Operating partners drive value creation.",
      "## Returns",
      "Target 25% gross IRR and 3.0x MOIC.",
      "## Check size",
      "$10–30M equity at the lower-middle market.",
      "## Risk",
      "Cyclicality is mitigated by diversification across " + "many ".repeat(120) + "names.",
    ].join("\n");
    const r = scoreDocument("Strategy", "thesis", content);
    expect(r.level).toBe("Institutional");
    expect(r.score).toBeGreaterThanOrEqual(80);
  });

  it("requires figures for quantitative sections", () => {
    const longText = "## Track Record\n" + "word ".repeat(200) + "\nrealized deal attribution moic irr";
    const noNumbers = scoreDocument("TR", "track_record", longText);
    expect(noNumbers.checks.find((c) => c.label.includes("figures"))?.ok).toBe(false);
  });

  it("does not require figures for non-quantitative sections", () => {
    expect(sectionGuidance("team").quantitative).toBe(false);
  });
});
