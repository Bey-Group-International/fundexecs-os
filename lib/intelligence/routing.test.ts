// Tests for the Earn → executive routing matrix + Tier-3 safety invariant.
import { routeIntelligence } from "./routing";
import { tierForAction } from "@/lib/gates";
import type { RelevanceDimensions, ExposureType } from "./types";

function dims(over: Partial<RelevanceDimensions> = {}): RelevanceDimensions {
  return {
    mandateRelevance: 0,
    dealRelevance: 0,
    portfolioRelevance: 0,
    relationshipRelevance: 0,
    regulatoryRelevance: 0,
    materiality: 0,
    urgency: 0,
    confidence: 0,
    ...over,
  };
}

describe("routeIntelligence", () => {
  it("routes deal-dominant to diligence (internal research, Tier 1)", () => {
    const r = routeIntelligence(dims({ dealRelevance: 80 }), new Set<ExposureType>(["deal"]));
    expect(r.agent).toBe("diligence");
    expect(r.requiredTier).toBe(1);
  });

  it("routes portfolio-dominant to portfolio_ops", () => {
    const r = routeIntelligence(dims({ portfolioRelevance: 90 }), new Set<ExposureType>(["portfolio_company"]));
    expect(r.agent).toBe("portfolio_ops");
  });

  it("routes LP relationship exposure to investor_relations", () => {
    const r = routeIntelligence(dims({ relationshipRelevance: 70 }), new Set<ExposureType>(["lp"]));
    expect(r.agent).toBe("investor_relations");
  });

  it("routes lender relationship exposure to capital_connector", () => {
    const r = routeIntelligence(dims({ relationshipRelevance: 70 }), new Set<ExposureType>(["lender"]));
    expect(r.agent).toBe("capital_connector");
  });

  it("routes regulatory-dominant to executive_advisor", () => {
    const r = routeIntelligence(dims({ regulatoryRelevance: 85, dealRelevance: 50 }), new Set<ExposureType>());
    expect(r.agent).toBe("executive_advisor");
  });

  it("falls back to analyst when nothing is dominant", () => {
    const r = routeIntelligence(dims(), new Set<ExposureType>());
    expect(r.agent).toBe("analyst");
    expect(r.requiredTier).toBe(1);
  });

  it("NEVER emits a Tier-3 follow-on action from an external signal", () => {
    // Exhaustively check every dominant-dimension branch.
    const cases: Array<[Partial<RelevanceDimensions>, Set<ExposureType>]> = [
      [{ mandateRelevance: 100 }, new Set(["mandate"])],
      [{ dealRelevance: 100 }, new Set(["deal"])],
      [{ portfolioRelevance: 100 }, new Set(["portfolio_company"])],
      [{ relationshipRelevance: 100 }, new Set(["lp"])],
      [{ relationshipRelevance: 100 }, new Set(["lender"])],
      [{ regulatoryRelevance: 100 }, new Set([])],
    ];
    for (const [d, ex] of cases) {
      const r = routeIntelligence(dims(d), ex as Set<ExposureType>);
      expect(r.requiredTier).toBeLessThanOrEqual(2);
      expect(tierForAction(r.sendAction)).not.toBe(3);
    }
  });

  it("outward-facing agents carry a Tier-2 send that the gate will hold", () => {
    const r = routeIntelligence(dims({ relationshipRelevance: 70 }), new Set<ExposureType>(["lp"]));
    expect(r.requiredTier).toBe(2);
  });
});
