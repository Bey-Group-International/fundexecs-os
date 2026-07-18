// Tests for the bridge into Earn's existing proactive loop.
import { assessmentToSignal, BRIDGE_ACTIONABILITY_FLOOR } from "./signal-bridge";
import type { ExposureType, IntelligenceAssessment, IntelligenceObservation } from "./types";

function observation(over: Partial<IntelligenceObservation> = {}): IntelligenceObservation {
  return {
    id: "o1",
    workspaceId: "org1",
    provider: "signal_bureau",
    providerRecordId: "sig_1",
    providerSchemaVersion: "sb.signals.v1",
    observationType: "signal",
    title: "Acme raise",
    summary: "raising",
    observedAt: "2026-07-08T00:00:00.000Z",
    providerAsOf: "2026-07-08T00:00:00.000Z",
    ingestedAt: "2026-07-09T00:00:00.000Z",
    freshnessStatus: "fresh",
    evidenceStatus: "receipted",
    confidence: 0.8,
    sourceUrls: ["https://s.example/1"],
    rawPayload: {},
    contentHash: "h",
    deduplicationKey: "signal_bureau:sig_1",
    expiresAt: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function assessment(over: Partial<IntelligenceAssessment> = {}): IntelligenceAssessment {
  return {
    observationId: "o1",
    mandateRelevance: 0,
    dealRelevance: 60,
    portfolioRelevance: 0,
    relationshipRelevance: 0,
    regulatoryRelevance: 0,
    materiality: 60,
    urgency: 55,
    confidence: 70,
    actionability: 62,
    potentialImpact: null,
    timeHorizon: "near_term",
    implications: {},
    invalidators: null,
    monitoringCondition: null,
    recommendedAction: "Investigate deal implications.",
    assignedAgent: "diligence",
    requiredTier: 1,
    sendAction: "research",
    scoreBreakdown: {},
    weightsVersion: "v1",
    ...over,
  };
}

describe("assessmentToSignal", () => {
  it("classes external-provider intelligence as market (forces the investor-facing gate floor)", () => {
    const { signal } = assessmentToSignal(observation(), assessment(), new Set<ExposureType>(["deal"]));
    expect(signal.signalClass).toBe("market");
  });

  it("classes native (manual) intelligence as internal", () => {
    const { signal } = assessmentToSignal(observation({ provider: "native" }), assessment(), new Set<ExposureType>(["deal"]));
    expect(signal.signalClass).toBe("internal");
  });

  it("places the signal in the assigned agent's hub", () => {
    const { signal } = assessmentToSignal(observation(), assessment({ assignedAgent: "diligence" }), new Set<ExposureType>(["deal"]));
    expect(signal.hub).toBe("run"); // diligence is a Run-hub agent
  });

  it("carries observation provenance in metadata and the routed send action", () => {
    const bridged = assessmentToSignal(observation(), assessment(), new Set<ExposureType>(["deal"]));
    expect(bridged.signal.metadata.observationId).toBe("o1");
    expect(bridged.signal.metadata.provider).toBe("signal_bureau");
    expect(bridged.sendAction).toBe("research");
  });

  it("marks actionability below the floor as not actionable", () => {
    const below = assessmentToSignal(observation(), assessment({ actionability: BRIDGE_ACTIONABILITY_FLOOR - 1 }), new Set<ExposureType>(["deal"]));
    expect(below.actionable).toBe(false);
    const above = assessmentToSignal(observation(), assessment({ actionability: BRIDGE_ACTIONABILITY_FLOOR + 1 }), new Set<ExposureType>(["deal"]));
    expect(above.actionable).toBe(true);
  });

  it("maps LP exposure to an investor subject", () => {
    const { signal } = assessmentToSignal(observation(), assessment({ assignedAgent: "investor_relations" }), new Set<ExposureType>(["lp"]));
    expect(signal.subjectType).toBe("investor");
  });
});
