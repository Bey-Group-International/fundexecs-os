import { tokenize, computeGroundingScore, isVerifiable, GROUNDING_THRESHOLD } from "@/lib/grounding";
import type { ArtifactSource } from "@/lib/artifact-provenance";

const src = (snippet: string): ArtifactSource => ({ source: "doc", snippet, score: 0.5, kind: "document" });

describe("tokenize", () => {
  it("lowercases, splits, and drops stopwords + short tokens", () => {
    expect(tokenize("The EBITDA was $12M in 2024")).toEqual(["ebitda", "12m", "2024"]);
  });
});

describe("computeGroundingScore", () => {
  it("is 0 with no sources", () => {
    expect(computeGroundingScore("anything", [])).toBe(0);
  });

  it("is 0 when sources have no usable tokens", () => {
    expect(computeGroundingScore("real content here", [src("the a of to")])).toBe(0);
  });

  it("is 1.0 when the output reflects every cited token", () => {
    const sources = [src("EBITDA margin expansion")];
    // content contains ebitda, margin, expansion → full overlap.
    expect(computeGroundingScore("The EBITDA margin expansion was strong", sources)).toBe(1);
  });

  it("is fractional when the output reflects only some cited tokens", () => {
    const sources = [src("ebitda margin leverage covenant")]; // 4 salient tokens
    const score = computeGroundingScore("ebitda margin discussion", sources); // 2 of 4
    expect(score).toBeCloseTo(0.5, 5);
  });

  it("stays within [0,1]", () => {
    const score = computeGroundingScore("ebitda ebitda ebitda", [src("ebitda")]);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe("isVerifiable", () => {
  it("is true when an operator verified it, regardless of score", () => {
    expect(isVerifiable({ verification_status: "verified", grounding_score: 0 })).toBe(true);
  });

  it("is true when grounding meets the threshold", () => {
    expect(isVerifiable({ verification_status: "unverified", grounding_score: GROUNDING_THRESHOLD })).toBe(true);
  });

  it("is false when unverified and weakly grounded", () => {
    expect(isVerifiable({ verification_status: "unverified", grounding_score: GROUNDING_THRESHOLD - 0.01 })).toBe(false);
    expect(isVerifiable({})).toBe(false);
  });
});
