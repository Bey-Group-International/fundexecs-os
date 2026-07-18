// Tests for the native relevance & materiality engine.
import { scoreRelevance, resolveWeights, DEFAULT_WEIGHTS, type RelevanceInput } from "./relevance";

function input(over: Partial<RelevanceInput> = {}): RelevanceInput {
  return {
    confidence: 0.9,
    evidenceStatus: "receipted",
    freshnessStatus: "fresh",
    entityMatchStrength: 1,
    exposures: [{ exposureType: "portfolio_company", materiality: 80 }],
    urgencyHint: 50,
    regulatorySalience: 0,
    providerCalibration: null,
    ...over,
  };
}

describe("scoreRelevance", () => {
  it("keeps every dimension separately visible", () => {
    const r = scoreRelevance(input());
    expect(r.dimensions.portfolioRelevance).toBeGreaterThan(0);
    expect(r.dimensions).toHaveProperty("mandateRelevance");
    expect(r.dimensions).toHaveProperty("regulatoryRelevance");
    expect(r.breakdown.baseRelevance).toBeGreaterThan(0);
    expect(r.breakdown.trustMultiplier).toBeGreaterThan(0);
  });

  it("routes exposure types into the right dimensions", () => {
    const r = scoreRelevance(input({ exposures: [
      { exposureType: "deal", materiality: 70 },
      { exposureType: "lp", materiality: 40 },
    ] }));
    expect(r.dimensions.dealRelevance).toBe(70);
    expect(r.dimensions.relationshipRelevance).toBe(40);
    expect(r.dimensions.portfolioRelevance).toBe(0);
  });

  it("discounts an unreceipted, stale lead below an equivalent receipted, fresh one", () => {
    const strong = scoreRelevance(input());
    const weak = scoreRelevance(input({ evidenceStatus: "unreceipted", freshnessStatus: "stale" }));
    expect(weak.actionability).toBeLessThan(strong.actionability);
    // Trust can only ever pull the score DOWN, never above the base relevance.
    expect(weak.actionability).toBeLessThanOrEqual(weak.breakdown.baseRelevance);
  });

  it("treats trajectory/urgency as one input, not the whole score", () => {
    const low = scoreRelevance(input({ urgencyHint: 0 }));
    const high = scoreRelevance(input({ urgencyHint: 100 }));
    // Urgency moves the score but does not dominate a high-materiality item.
    expect(high.actionability).toBeGreaterThan(low.actionability);
    expect(low.actionability).toBeGreaterThan(0);
  });

  it("honours a workspace weight override and stamps the version", () => {
    const base = scoreRelevance(input({ exposures: [{ exposureType: "mandate", materiality: 60 }] }));
    const boosted = scoreRelevance(
      input({ exposures: [{ exposureType: "mandate", materiality: 60 }] }),
      { mandateRelevance: 5 },
    );
    expect(boosted.actionability).toBeGreaterThan(base.actionability);
    expect(boosted.breakdown.weights.version).toContain("override");
  });

  it("never exceeds 100", () => {
    const r = scoreRelevance(input({ exposures: [{ exposureType: "deal", materiality: 100 }], urgencyHint: 100, regulatorySalience: 100 }));
    expect(r.actionability).toBeLessThanOrEqual(100);
  });
});

describe("resolveWeights", () => {
  it("returns defaults when no override", () => {
    expect(resolveWeights()).toBe(DEFAULT_WEIGHTS);
  });
});
