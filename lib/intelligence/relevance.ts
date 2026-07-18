// lib/intelligence/relevance.ts
// The native relevance & materiality engine. External providers identify
// ACTIVITY; FundExecs determines RELEVANCE. Pure + tested.
//
// Design rules the product spec mandates:
//   • Every dimension stays SEPARATELY VISIBLE — never one opaque score. The
//     eight relevance dimensions and the trust components are all returned and
//     recorded in scoreBreakdown so a user can see WHY an item was elevated.
//   • Provider trajectory / acceleration is ONE input, not the final score.
//   • Trust (evidence, freshness, confidence, provider calibration) DISCOUNTS
//     relevance — it can only ever pull actionability DOWN, so an unreceipted,
//     stale lead can never ride firm-relevance into a high actionability score.
//   • Weights are workspace-configurable, VERSIONED, auditable, and overrideable.

import type {
  EvidenceStatus,
  FreshnessStatus,
  RelevanceDimensions,
  ExposureType,
} from "./types";

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** The exposures the engine reasons over, at the grain it needs. */
export interface ExposureInput {
  exposureType: ExposureType;
  /** 0–100 materiality of this specific exposure. */
  materiality: number;
}

/** Everything the engine needs, assembled from persisted rows by assess.ts. */
export interface RelevanceInput {
  /** 0–1 provider/observer confidence in the observation itself. */
  confidence: number;
  evidenceStatus: EvidenceStatus;
  freshnessStatus: FreshnessStatus;
  /** 0–1 strength of the best entity match (0 when nothing matched). */
  entityMatchStrength: number;
  /** The firm exposures this observation touches. */
  exposures: ExposureInput[];
  /** 0–100 time-pressure hint (proximity to an expiry / event). */
  urgencyHint: number;
  /** 0–100 regulatory salience (regulation/sanctions/policy entities). */
  regulatorySalience: number;
  /** 0–1 provider calibration (get_calibration). Null when undisclosed. */
  providerCalibration: number | null;
}

/** Workspace-configurable, versioned weights over the relevance dimensions. */
export interface RelevanceWeights {
  version: string;
  mandateRelevance: number;
  dealRelevance: number;
  portfolioRelevance: number;
  relationshipRelevance: number;
  regulatoryRelevance: number;
  materiality: number;
  urgency: number;
}

/** Default weights. weightsVersion 'v1'. Overrideable per workspace + auditable. */
export const DEFAULT_WEIGHTS: RelevanceWeights = {
  version: "v1",
  mandateRelevance: 1.4,
  dealRelevance: 1.2,
  portfolioRelevance: 1.2,
  relationshipRelevance: 1.0,
  regulatoryRelevance: 1.1,
  materiality: 1.3,
  urgency: 0.9,
};

/** Merge a partial override onto the defaults, stamping the resolved version. */
export function resolveWeights(override?: Partial<RelevanceWeights>): RelevanceWeights {
  if (!override) return DEFAULT_WEIGHTS;
  return {
    ...DEFAULT_WEIGHTS,
    ...override,
    version: override.version ?? `${DEFAULT_WEIGHTS.version}+override`,
  };
}

// Which exposure types roll up into which relevance dimension.
const MANDATE_TYPES: ExposureType[] = ["mandate", "thesis"];
const DEAL_TYPES: ExposureType[] = ["deal", "pipeline_opportunity"];
const PORTFOLIO_TYPES: ExposureType[] = ["portfolio_company", "fund", "operating_initiative"];
const RELATIONSHIP_TYPES: ExposureType[] = ["lp", "capital_provider", "lender", "vendor"];

/** Max materiality among exposures of the given types (0 when none). */
function dimensionFromExposures(exposures: ExposureInput[], types: ExposureType[]): number {
  const relevant = exposures.filter((e) => types.includes(e.exposureType));
  if (relevant.length === 0) return 0;
  return clamp(Math.max(...relevant.map((e) => e.materiality)));
}

// Trust-component multipliers — each in [0,1], can only discount.
const EVIDENCE_WEIGHT: Record<EvidenceStatus, number> = {
  corroborated: 1.0,
  receipted: 0.95,
  unreceipted: 0.6,
  unknown: 0.5,
};
const FRESHNESS_WEIGHT: Record<FreshnessStatus, number> = {
  fresh: 1.0,
  aging: 0.8,
  stale: 0.4,
};

/** The full breakdown the engine records — every input made explicit. */
export interface RelevanceResult {
  dimensions: RelevanceDimensions;
  actionability: number;
  breakdown: {
    weights: RelevanceWeights;
    baseRelevance: number;
    trustMultiplier: number;
    trust: {
      evidence: number;
      freshness: number;
      confidenceComponent: number;
      calibrationComponent: number;
    };
    entityMatchStrength: number;
  };
}

/**
 * Score an observation into visible dimensions + an explained actionability.
 *
 * actionability = baseRelevance × trustMultiplier, where baseRelevance is the
 * weighted average of the relevance dimensions and trustMultiplier ∈ [0,1] is
 * the product of the evidence/freshness/confidence/calibration discounts. Trust
 * only ever pulls the score DOWN.
 */
export function scoreRelevance(
  input: RelevanceInput,
  weightsOverride?: Partial<RelevanceWeights>,
): RelevanceResult {
  const weights = resolveWeights(weightsOverride);

  const mandateRelevance = dimensionFromExposures(input.exposures, MANDATE_TYPES);
  const dealRelevance = dimensionFromExposures(input.exposures, DEAL_TYPES);
  const portfolioRelevance = dimensionFromExposures(input.exposures, PORTFOLIO_TYPES);
  const relationshipRelevance = dimensionFromExposures(input.exposures, RELATIONSHIP_TYPES);
  const regulatoryRelevance = clamp(input.regulatorySalience);
  const materiality = input.exposures.length
    ? clamp(Math.max(...input.exposures.map((e) => e.materiality)))
    : 0;
  const urgency = clamp(input.urgencyHint);
  // Confidence is source-quality-adjusted by the strength of the entity match:
  // a signal we could not tie to anything we track is less trustworthy.
  const confidence = clamp(input.confidence * 100 * (0.5 + 0.5 * clamp(input.entityMatchStrength, 0, 1)));

  const dimensions: RelevanceDimensions = {
    mandateRelevance,
    dealRelevance,
    portfolioRelevance,
    relationshipRelevance,
    regulatoryRelevance,
    materiality,
    urgency,
    confidence,
  };

  // Weighted average of the seven relevance dimensions (confidence is folded
  // into the trust multiplier, not the base, so it can only discount).
  const weightPairs: Array<[number, number]> = [
    [mandateRelevance, weights.mandateRelevance],
    [dealRelevance, weights.dealRelevance],
    [portfolioRelevance, weights.portfolioRelevance],
    [relationshipRelevance, weights.relationshipRelevance],
    [regulatoryRelevance, weights.regulatoryRelevance],
    [materiality, weights.materiality],
    [urgency, weights.urgency],
  ];
  const weightSum = weightPairs.reduce((s, [, w]) => s + w, 0) || 1;
  const baseRelevance = clamp(weightPairs.reduce((s, [v, w]) => s + v * w, 0) / weightSum);

  const evidence = EVIDENCE_WEIGHT[input.evidenceStatus];
  const freshness = FRESHNESS_WEIGHT[input.freshnessStatus];
  const confidenceComponent = 0.5 + 0.5 * Math.max(0, Math.min(1, input.confidence));
  // Undisclosed calibration is neutral (1.0); a disclosed value nudges ±10%.
  const calibrationComponent =
    input.providerCalibration == null ? 1.0 : 0.9 + 0.2 * Math.max(0, Math.min(1, input.providerCalibration));
  const trustMultiplier = evidence * freshness * confidenceComponent * calibrationComponent;

  const actionability = clamp(baseRelevance * trustMultiplier);

  return {
    dimensions,
    actionability,
    breakdown: {
      weights,
      baseRelevance,
      trustMultiplier,
      trust: { evidence, freshness, confidenceComponent, calibrationComponent },
      entityMatchStrength: input.entityMatchStrength,
    },
  };
}
