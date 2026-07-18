// Tests for exposure derivation + assessment building (relevance × routing).
import { buildAssessment, deriveExposures } from "./assess";
import type { EntityMatch } from "./entity-match";
import type { ProviderObservation, TrackedEntity, TrackedEntityType } from "./types";

function obs(over: Partial<ProviderObservation> = {}): ProviderObservation {
  return {
    provider: "signal_bureau",
    providerRecordId: "sig_1",
    providerSchemaVersion: "sb.signals.v1",
    observationType: "signal",
    title: "Acme portfolio company hit by supply shock",
    summary: "Operations affected",
    observedAt: "2026-07-08T00:00:00.000Z",
    providerAsOf: "2026-07-08T00:00:00.000Z",
    evidenceStatus: "receipted",
    confidence: 0.8,
    sourceUrls: ["https://s.example/1"],
    rawPayload: {},
    entityHints: [{ name: "Acme" }],
    expiresAt: null,
    trajectory: "accelerating",
    urgencyHint: 60,
    ...over,
  };
}

function entity(type: TrackedEntityType, name = "Acme"): TrackedEntity {
  return {
    id: `e_${type}`,
    workspaceId: "org1",
    entityType: type,
    name,
    aliases: [],
    description: null,
    externalIdentifiers: {},
    status: "active",
    createdBy: null,
    createdAt: "",
    updatedAt: "",
  };
}

function match(type: TrackedEntityType, confidence = 0.95): EntityMatch {
  return { entity: entity(type), method: "exact", confidence, providerRelationship: null };
}

describe("deriveExposures", () => {
  it("maps a portfolio-company match to a portfolio exposure", () => {
    const d = deriveExposures(obs(), [match("portfolio_company")]);
    expect(d.exposureTypes.has("portfolio_company")).toBe(true);
    expect(d.records[0].materiality).toBeGreaterThan(0);
  });

  it("raises regulatory salience for a regulation entity and for regulatory text", () => {
    const reg = deriveExposures(obs(), [match("regulation")]);
    expect(reg.regulatorySalience).toBeGreaterThan(0);

    const text = deriveExposures(obs({ title: "New antitrust enforcement action" }), []);
    expect(text.regulatorySalience).toBeGreaterThanOrEqual(60);
  });

  it("produces no exposure when nothing matched", () => {
    const d = deriveExposures(obs(), []);
    expect(d.records).toHaveLength(0);
  });
});

describe("buildAssessment", () => {
  it("routes a portfolio observation to portfolio_ops with a Tier-1 follow-on", () => {
    const { assessment } = buildAssessment("o1", obs(), [match("portfolio_company")]);
    expect(assessment.assignedAgent).toBe("portfolio_ops");
    expect(assessment.requiredTier).toBe(1);
    expect(assessment.actionability).toBeGreaterThan(0);
    expect(assessment.scoreBreakdown).toHaveProperty("weights");
    expect(assessment.weightsVersion).toBe("v1");
  });

  it("flags an unreceipted lead in the potential-impact prose", () => {
    const { assessment } = buildAssessment("o1", obs({ evidenceStatus: "unreceipted" }), [match("portfolio_company")]);
    expect(assessment.potentialImpact).toContain("Unreceipted lead");
  });

  it("stale freshness lowers actionability versus fresh", () => {
    const fresh = buildAssessment("o1", obs(), [match("target_company")], "fresh").assessment;
    const stale = buildAssessment("o1", obs(), [match("target_company")], "stale").assessment;
    expect(stale.actionability).toBeLessThan(fresh.actionability);
  });

  it("always carries a routed send action that is never Tier 3", () => {
    const { assessment } = buildAssessment("o1", obs({ title: "Acme sanctions exposure" }), [match("regulation")]);
    expect(assessment.requiredTier).toBeLessThanOrEqual(2);
  });
});
