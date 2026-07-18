// lib/intelligence/assess.ts
// Turns a normalized observation + its entity matches into FundExecs' own
// assessment: the visible relevance dimensions, an explained actionability, the
// exposures it touches, and the specialist + gate tier to route it to. Pure +
// deterministic (v1) so it is fully testable; richer LLM-authored impact/
// scenario prose is a documented follow-on that reuses this same shape.

import type { AgentKey } from "@/lib/supabase/database.types";
import type { FreshnessStatus, ProviderObservation, ExposureType, IntelligenceAssessment, TimeHorizon, TrackedEntityType } from "./types";
import type { EntityMatch } from "./entity-match";
import { bestMatchStrength } from "./entity-match";
import { scoreRelevance, type ExposureInput, type RelevanceWeights } from "./relevance";
import { routeIntelligence } from "./routing";
import type { ExposureRecord } from "./store";

// entity type → (exposure type, weight into its dimension).
const ENTITY_EXPOSURE: Partial<Record<TrackedEntityType, { type: ExposureType; weight: number }>> = {
  portfolio_company: { type: "portfolio_company", weight: 0.9 },
  fund: { type: "fund", weight: 0.8 },
  investor: { type: "lp", weight: 0.8 },
  lender: { type: "lender", weight: 0.8 },
  sponsor: { type: "capital_provider", weight: 0.7 },
  target_company: { type: "deal", weight: 0.9 },
  company: { type: "pipeline_opportunity", weight: 0.6 },
  sector: { type: "sector", weight: 0.6 },
  commodity: { type: "sector", weight: 0.5 },
  geography: { type: "geography", weight: 0.5 },
  technology: { type: "thesis", weight: 0.5 },
  macro_event: { type: "thesis", weight: 0.5 },
  concern: { type: "thesis", weight: 0.7 },
  individual: { type: "lp", weight: 0.4 },
};

const REG_TEXT = /regulat|sanction|antitrust|policy|compliance|enforcement|subpoena|lawsuit/i;

export interface DerivedExposures {
  inputs: ExposureInput[];
  records: ExposureRecord[];
  regulatorySalience: number;
  exposureTypes: Set<ExposureType>;
}

/** Derive firm exposures from the matched tracked entities. Pure. */
export function deriveExposures(obs: ProviderObservation, matches: EntityMatch[]): DerivedExposures {
  const inputs: ExposureInput[] = [];
  const records: ExposureRecord[] = [];
  const exposureTypes = new Set<ExposureType>();
  let regulatorySalience = 0;

  for (const m of matches) {
    const map = ENTITY_EXPOSURE[m.entity.entityType];
    if (m.entity.entityType === "regulation") {
      regulatorySalience = Math.max(regulatorySalience, Math.round(80 * m.confidence));
    }
    if (m.entity.entityType === "macro_event") {
      regulatorySalience = Math.max(regulatorySalience, Math.round(55 * m.confidence));
    }
    if (!map) continue;
    const materiality = Math.round(m.confidence * map.weight * 100);
    inputs.push({ exposureType: map.type, materiality });
    exposureTypes.add(map.type);
    records.push({
      exposureType: map.type,
      entityId: m.entity.id,
      targetType: "tracked_entity",
      targetId: m.entity.id,
      targetName: m.entity.name,
      exposureDirection: "neutral",
      exposureMagnitude: materiality,
      materiality,
      rationale: `Observation references ${m.entity.name} (${m.entity.entityType}, matched by ${m.method}).`,
    });
  }

  // Text-based regulatory salience floor, independent of matched entities.
  if (REG_TEXT.test(obs.title) || REG_TEXT.test(obs.summary ?? "")) {
    regulatorySalience = Math.max(regulatorySalience, 60);
  }

  return { inputs, records, regulatorySalience: Math.min(100, regulatorySalience), exposureTypes };
}

function timeHorizon(obs: ProviderObservation): TimeHorizon {
  if (obs.expiresAt) {
    const hours = (Date.parse(obs.expiresAt) - Date.parse(obs.providerAsOf ?? obs.observedAt ?? new Date(0).toISOString())) / 3_600_000;
    if (!Number.isNaN(hours)) {
      if (hours <= 168) return "immediate";
      if (hours <= 720) return "near_term";
    }
  }
  if (obs.trajectory === "accelerating") return "near_term";
  if (obs.trajectory === "decelerating") return "long_term";
  if (obs.trajectory === "steady") return "medium_term";
  return "unknown";
}

/**
 * Build the full assessment. Deterministic: the relevance engine scores the
 * dimensions, the routing matrix picks the specialist + follow-on tier, and the
 * exposures + trajectory drive templated impact/monitoring prose (v1).
 */
export function buildAssessment(
  observationId: string,
  obs: ProviderObservation,
  matches: EntityMatch[],
  freshnessStatus: FreshnessStatus = "fresh",
  weightsOverride?: Partial<RelevanceWeights>,
): { assessment: IntelligenceAssessment; exposures: ExposureRecord[] } {
  const derived = deriveExposures(obs, matches);
  const matchStrength = bestMatchStrength(matches);

  const scored = scoreRelevance(
    {
      confidence: obs.confidence,
      evidenceStatus: obs.evidenceStatus,
      freshnessStatus,
      entityMatchStrength: matchStrength,
      exposures: derived.inputs,
      urgencyHint: obs.urgencyHint ?? 25,
      regulatorySalience: derived.regulatorySalience,
      providerCalibration: null,
    },
    weightsOverride,
  );

  const route = routeIntelligence(scored.dimensions, derived.exposureTypes);

  const assigned: AgentKey = route.agent;
  const evidenceCaveat =
    obs.evidenceStatus === "unreceipted"
      ? " Unreceipted lead — confirm before acting."
      : obs.evidenceStatus === "unknown"
        ? " Evidence undisclosed by the provider."
        : "";

  const assessment: IntelligenceAssessment = {
    observationId,
    ...scored.dimensions,
    actionability: scored.actionability,
    potentialImpact: derived.records.length
      ? `Touches ${derived.records.length} tracked exposure(s): ${derived.records.map((r) => r.targetName).join(", ")}.${evidenceCaveat}`
      : `No confirmed firm exposure yet — monitor.${evidenceCaveat}`,
    timeHorizon: timeHorizon(obs),
    implications: {
      base: route.reason,
    },
    invalidators:
      "A corrected or retracted source, a stronger contradicting signal, or confirmation the linked entity is not in fact exposed.",
    monitoringCondition:
      obs.trajectory === "accelerating"
        ? "Re-check on the next sync; escalate if the trajectory holds."
        : "Re-check on the next scheduled sync.",
    recommendedAction: route.reason,
    assignedAgent: assigned,
    requiredTier: route.requiredTier,
    sendAction: route.sendAction,
    scoreBreakdown: {
      ...scored.breakdown,
      routing: { agent: route.agent, sendAction: route.sendAction, requiredTier: route.requiredTier },
      regulatorySalience: derived.regulatorySalience,
    },
    weightsVersion: scored.breakdown.weights.version,
  };

  return { assessment, exposures: derived.records };
}
