// lib/intelligence/signal-bridge.ts
// The bridge from the native intelligence core into Earn's EXISTING proactive
// loop (lib/proactive/*). This is how intelligence becomes operational without a
// parallel orchestrator: an actionable assessment is mapped to a proactive
// Signal, which the established Signal → Prioritize → Gate → Learn pipeline and
// the gate layer (lib/gates.ts) carry the rest of the way. Pure + tested.
//
// Because these signals are grounded in EXTERNAL intelligence, they are class
// "market" — lib/proactive/gate.ts floors any market-grounded send to Tier 2 so
// external data can never auto-send. This module never triggers anything; it
// only produces the signal + the routed send action for the proactive composer.

import type { AgentKey, Hub } from "@/lib/supabase/database.types";
import type { ActionKind } from "@/lib/gates";
import { AGENT_BY_KEY } from "@/lib/agents";
import type { Signal } from "@/lib/proactive/types";
import type { ExposureType, IntelligenceAssessment, IntelligenceObservation } from "./types";

/** The minimum actionability an assessment needs before it is worth surfacing. */
export const BRIDGE_ACTIONABILITY_FLOOR = 40;

function hubForAssignedAgent(agent: AgentKey | null): Hub {
  if (agent && AGENT_BY_KEY[agent]?.hub) return AGENT_BY_KEY[agent].hub as Hub;
  // Earn (associate) and unrouted items default to Run, the continuous hub.
  return "run";
}

// Map the exposures this observation touches to the proactive Signal's narrower
// subject vocabulary (investor | deal | document | fund | contract).
function subjectTypeFor(exposureTypes: Set<ExposureType>): Signal["subjectType"] {
  if (exposureTypes.has("lp") || exposureTypes.has("capital_provider")) return "investor";
  if (exposureTypes.has("fund")) return "fund";
  if (exposureTypes.has("deal") || exposureTypes.has("pipeline_opportunity") || exposureTypes.has("portfolio_company")) {
    return "deal";
  }
  return "deal";
}

export interface BridgedSignal {
  signal: Signal;
  /** The routed outward action the eventual approval would authorize. */
  sendAction: ActionKind;
  /** True when actionability cleared the surfacing floor. */
  actionable: boolean;
}

/**
 * Map an observation + its assessment into a proactive Signal. The caller (a
 * future intelligence trigger registered in lib/proactive/triggers) hands the
 * signal to the existing pipeline; nothing here bypasses the gate or the budget.
 */
export function assessmentToSignal(
  observation: IntelligenceObservation,
  assessment: IntelligenceAssessment,
  exposureTypes: Set<ExposureType>,
): BridgedSignal {
  const signal: Signal = {
    triggerKey: "intelligence_observation",
    hub: hubForAssignedAgent(assessment.assignedAgent),
    // External intelligence ⇒ market class ⇒ investor-facing gate floor.
    signalClass: observation.provider === "native" ? "internal" : "market",
    subjectType: subjectTypeFor(exposureTypes),
    subjectId: null,
    subjectName: observation.title,
    summary: assessment.recommendedAction ?? observation.summary ?? observation.title,
    occurredAt: observation.observedAt ?? observation.ingestedAt,
    baseConfidence: Math.round(assessment.confidence),
    baseUrgency: Math.round(assessment.urgency),
    metadata: {
      observationId: observation.id,
      provider: observation.provider,
      evidenceStatus: observation.evidenceStatus,
      freshnessStatus: observation.freshnessStatus,
      actionability: assessment.actionability,
      assignedAgent: assessment.assignedAgent,
      requiredTier: assessment.requiredTier,
      sourceUrls: observation.sourceUrls,
      weightsVersion: assessment.weightsVersion,
    },
  };

  return {
    signal,
    sendAction: assessment.sendAction,
    actionable: assessment.actionability >= BRIDGE_ACTIONABILITY_FLOOR,
  };
}
