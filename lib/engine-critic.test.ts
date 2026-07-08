// lib/engine-critic.test.ts
// Unit tests for the deterministic artifact critic. Pure — no DB, no key.
import { critiqueArtifact, criticView, parseCriticIssues } from "@/lib/engine-critic";

const goodMemo =
  "The EBITDA margin expanded 220 bps year over year, driven by pricing discipline " +
  "and supply-chain savings. Revenue grew 18% with net retention above 120%. " +
  "Recommend advancing the deal to confirmatory diligence.";

const src = (snippet: string) => ({ snippet });

describe("critiqueArtifact", () => {
  it("passes a substantive, on-topic, cited deliverable", () => {
    const r = critiqueArtifact({
      content: goodMemo,
      title: "EBITDA margin analysis",
      sources: [src("ebitda margin expansion pricing")],
    });
    expect(r.verdict).toBe("pass");
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.issues).toHaveLength(0);
  });

  it("fails a refusal", () => {
    const r = critiqueArtifact({
      content: "I cannot help with that request as an AI language model.",
      title: "EBITDA margin analysis",
    });
    expect(r.verdict).toBe("fail");
    expect(r.issues.join(" ")).toMatch(/refusal/i);
  });

  it("fails an empty or too-short deliverable", () => {
    const r = critiqueArtifact({ content: "See attached.", title: "Underwriting memo" });
    expect(r.verdict).toBe("fail");
    expect(r.issues.join(" ")).toMatch(/too short/i);
  });

  it("flags placeholder scaffolding", () => {
    const r = critiqueArtifact({
      content: "The analysis for <company> shows TODO: fill in the key metrics here later on.",
      title: "Company analysis",
      sources: [src("real evidence tokens here")],
    });
    expect(r.issues.join(" ")).toMatch(/placeholder/i);
    expect(r.verdict).not.toBe("pass");
  });

  it("flags off-topic drift via coverage", () => {
    const r = critiqueArtifact({
      content:
        "The weather in the region has been unusually mild this quarter and tourism " +
        "numbers rose across coastal towns and mountain resorts alike this season.",
      title: "Fund waterfall distribution schedule",
      sources: [src("waterfall distribution carry")],
    });
    expect(r.issues.join(" ")).toMatch(/does not visibly address/i);
  });

  it("mildly dings a deliverable with no sources", () => {
    const withSources = critiqueArtifact({
      content: goodMemo,
      title: "EBITDA margin analysis",
      sources: [src("ebitda margin")],
    });
    const without = critiqueArtifact({ content: goodMemo, title: "EBITDA margin analysis" });
    expect(without.score).toBeLessThan(withSources.score);
    expect(without.issues.join(" ")).toMatch(/no cited sources/i);
  });

  it("is deterministic", () => {
    const input = { content: goodMemo, title: "EBITDA margin analysis", sources: [src("ebitda")] };
    expect(critiqueArtifact(input)).toEqual(critiqueArtifact(input));
  });
});

describe("criticView", () => {
  it("shows nothing for a pass or a legacy artifact with no verdict", () => {
    expect(criticView({ verdict: "pass", issues: [] }).show).toBe(false);
    expect(criticView({ verdict: null }).show).toBe(false);
    expect(criticView({}).show).toBe(false);
  });

  it("warns for a revise verdict and joins the issues into the detail", () => {
    const v = criticView({ verdict: "revise", issues: ["No cited sources", "Hedges"] });
    expect(v.show).toBe(true);
    expect(v.tone).toBe("warn");
    expect(v.label).toBe("Critic: review");
    expect(v.detail).toBe("No cited sources · Hedges");
  });

  it("alerts for a fail verdict", () => {
    const v = criticView({ verdict: "fail", issues: [] });
    expect(v.show).toBe(true);
    expect(v.tone).toBe("alert");
    expect(v.label).toBe("Critic: fail");
    expect(v.detail).toMatch(/flagged/);
  });
});

describe("parseCriticIssues", () => {
  it("keeps only string entries, tolerating junk", () => {
    expect(parseCriticIssues(["a", "b"])).toEqual(["a", "b"]);
    expect(parseCriticIssues(["a", 1, null, "b"])).toEqual(["a", "b"]);
    expect(parseCriticIssues(null)).toEqual([]);
    expect(parseCriticIssues("nope")).toEqual([]);
  });
});
