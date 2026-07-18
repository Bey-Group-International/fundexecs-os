// Golden tests for the ic-memo deterministic core. The core PREPARES an IC
// pre-read from structured deal data; it never DECIDES. A missing input becomes
// an open item — never a fabricated fact.
import { icMemo, type IcMemoInput } from "./ic-memo";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "investment_committee" };
const run = (input: IcMemoInput) => icMemo.run(input, ctx);

const HEADINGS = [
  "Executive Summary",
  "Recommendation",
  "Transaction Overview",
  "Investment Thesis",
  "Market",
  "Financials & Valuation",
  "Returns",
  "Key Risks",
  "Mitigants",
  "Open Items",
  "Conditions Precedent",
  "Decision History",
];

describe("ic-memo core", () => {
  it("assembles all twelve headings in the fixed order", () => {
    const r = run({ deal: { companyName: "Acme Widgets" } });
    expect(r.structured.sections.map((s) => s.heading)).toEqual(HEADINGS);
  });

  it("assembles a complete memo from full structured deal data", () => {
    const r = run({
      deal: { companyName: "Acme Widgets", sector: "Manufacturing", geography: "North America", transactionType: "Buyout" },
      thesis: "Consolidate a fragmented components market and expand margins.",
      screen: { verdict: "pass", overall: 82, keyRisks: ["Customer concentration", "Cyclical end-markets"] },
      returns: { moic: 2.8, irrPct: 24, entryEv: 96, exitEv: 210 },
      market: "Growing at 6% CAGR with no dominant incumbent.",
      mitigants: ["Long-term contracts", "Diversified backlog"],
      recommendation: "Advance to full IC review with a confirmatory diligence budget.",
    });
    expect(r.structured.missingSections).toEqual([]);
    expect(r.structured.completeness).toBe(1);
    expect(r.structured.sections.every((s) => s.status === "complete")).toBe(true);
    // Provided figures are recorded as FACTS.
    expect(r.sources.find((s) => s.label === "MOIC")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "IRR %")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "Screen verdict")?.kind).toBe("fact");
  });

  it("PREPARES, never DECIDES: recommendation is labelled preliminary/advisory", () => {
    const r = run({ deal: { companyName: "Acme" }, screen: { verdict: "pass" } });
    const rec = r.structured.sections.find((s) => s.heading === "Recommendation");
    expect(rec?.body).toMatch(/PRELIMINARY/);
    expect(rec?.body).toMatch(/NOT a decision/);
    // Neutral derived recommendation from the pass verdict.
    expect(r.structured.recommendation).toBe("Advance to full IC review");
    // The verdict→posture mapping is an ASSUMPTION, and the recommendation is GENERATED.
    expect(r.sources.find((s) => s.label === "Assumed recommendation basis")?.kind).toBe("assumption");
    expect(r.sources.find((s) => s.label === "Preliminary recommendation")?.kind).toBe("generated");
  });

  it("derives neutral placeholders for each verdict", () => {
    expect(run({ deal: { companyName: "A" }, screen: { verdict: "pass" } }).structured.recommendation).toBe("Advance to full IC review");
    expect(run({ deal: { companyName: "A" }, screen: { verdict: "watch" } }).structured.recommendation).toBe("Conditional — resolve open items first");
    expect(run({ deal: { companyName: "A" }, screen: { verdict: "fail" } }).structured.recommendation).toBe("Do not proceed");
  });

  it("prefers an explicit recommendation over the derived placeholder", () => {
    const r = run({ deal: { companyName: "A" }, screen: { verdict: "fail" }, recommendation: "Revisit next cycle after a repricing." });
    expect(r.structured.recommendation).toBe("Revisit next cycle after a repricing.");
    const rec = r.structured.sections.find((s) => s.heading === "Recommendation");
    expect(rec?.status).toBe("complete");
  });

  it("a missing Returns input becomes an OPEN ITEM, never a fabricated fact", () => {
    const r = run({ deal: { companyName: "Mystery Co" } });
    const returns = r.structured.sections.find((s) => s.heading === "Returns");
    expect(returns?.status).toBe("open");
    expect(returns?.body).toMatch(/Pending — run the returns skill/);
    expect(r.structured.openItems).toEqual(expect.arrayContaining(["Returns pending — run the returns skill."]));
    // Nothing fabricated: no fact source carries a MOIC/IRR figure.
    expect(r.sources.some((s) => s.label === "MOIC")).toBe(false);
    expect(r.sources.some((s) => s.label === "IRR %")).toBe(false);
  });

  it("never fabricates a market claim when market is absent", () => {
    const r = run({ deal: { companyName: "Mystery Co" } });
    const market = r.structured.sections.find((s) => s.heading === "Market");
    expect(market?.status).toBe("open");
    expect(market?.body).toMatch(/No market claims are asserted without a source/);
  });

  it("flags Mitigants pending when risks are present but no mitigants", () => {
    const r = run({ deal: { companyName: "A" }, screen: { verdict: "watch", keyRisks: ["Regulatory exposure"] } });
    const mit = r.structured.sections.find((s) => s.heading === "Mitigants");
    expect(mit?.status).toBe("open");
    expect(r.structured.openItems).toContain("Mitigants pending");
  });

  it("recommendation is an open item when neither recommendation nor verdict is provided", () => {
    const r = run({ deal: { companyName: "A" } });
    const rec = r.structured.sections.find((s) => s.heading === "Recommendation");
    expect(rec?.status).toBe("open");
    expect(r.structured.openItems).toEqual(expect.arrayContaining([expect.stringMatching(/Recommendation pending/)]));
  });

  it("always emits the standard generated conditions precedent", () => {
    const r = run({ deal: { companyName: "A" } });
    expect(r.structured.conditionsPrecedent).toEqual([
      "Confirmatory diligence complete",
      "Final IC approval",
      "Definitive documentation",
    ]);
    expect(r.sources.find((s) => s.label === "Conditions precedent")?.kind).toBe("generated");
    const cp = r.structured.sections.find((s) => s.heading === "Conditions Precedent");
    expect(cp?.status).toBe("complete");
  });

  it("Decision History is a placeholder with no decisions recorded", () => {
    const r = run({ deal: { companyName: "A" } });
    const dh = r.structured.sections.find((s) => s.heading === "Decision History");
    expect(dh?.body).toBe("No decisions recorded yet.");
  });

  it("completeness reflects the fraction of complete sections and lists missing headings", () => {
    const r = run({ deal: { companyName: "A" } });
    // Only Executive Summary, Transaction Overview, Open Items, Conditions
    // Precedent, and Decision History are complete on a bare input → 5/12.
    expect(r.structured.completeness).toBeCloseTo(5 / 12, 2);
    expect(r.structured.missingSections).toEqual(
      expect.arrayContaining(["Recommendation", "Investment Thesis", "Market", "Financials & Valuation", "Returns", "Key Risks", "Mitigants"]),
    );
    expect(r.missingData).toEqual(r.structured.missingSections);
  });

  it("the Open Items section enumerates the collected open items", () => {
    const r = run({ deal: { companyName: "A" } });
    const oi = r.structured.sections.find((s) => s.heading === "Open Items");
    expect(oi?.status).toBe("complete");
    expect(oi?.body).toMatch(/Returns pending/);
  });

  it("always produces a narrative that states it prepares, not decides", () => {
    const r = run({ deal: { companyName: "A" }, screen: { verdict: "pass" } });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.narrative).toMatch(/does not make the investment decision/);
  });
});
