// lib/intelligence/types.ts
// The native FundExecs Intelligence Core — provider-neutral canonical model.
//
// FundExecs owns intelligence. A provider (Signal Bureau, or any future source)
// is an OPTIONAL feed whose payloads are normalized into these types by an
// anti-corruption adapter (lib/intelligence/providers/*). Business logic never
// touches a provider payload — only these shapes. This file is pure types +
// enums; no I/O, so every downstream stage (dedup, relevance, entity match,
// routing) is unit-testable in isolation.

import type { AgentKey, Hub } from "@/lib/supabase/database.types";
import type { ActionKind, GateTier } from "@/lib/gates";

// ---------------------------------------------------------------------------
// Provenance vocabulary — never collapse these into one another.
// ---------------------------------------------------------------------------

/** How fresh the underlying data is, judged against a per-source TTL. */
export type FreshnessStatus = "fresh" | "aging" | "stale";

/**
 * The evidence standing of an observation. `receipted` = the provider supplied
 * a verifiable source; `corroborated` = independently confirmed; `unreceipted` =
 * a lead with no receipt (must be visibly distinguished, never shown as fact);
 * `unknown` = the provider did not disclose.
 */
export type EvidenceStatus = "receipted" | "corroborated" | "unreceipted" | "unknown";

/** Whether a surfaced fact is provider-supplied, model-inferred, or human-confirmed. */
export type Attribution = "provider" | "inferred" | "human";

/** The kinds of thing FundExecs tracks. Mirrors the tracked_entities enum. */
export type TrackedEntityType =
  | "company"
  | "fund"
  | "investor"
  | "lender"
  | "sponsor"
  | "individual"
  | "portfolio_company"
  | "target_company"
  | "sector"
  | "geography"
  | "commodity"
  | "regulation"
  | "technology"
  | "macro_event"
  | "concern";

// ---------------------------------------------------------------------------
// The provider boundary — the ONLY shape a provider adapter may emit. It is the
// anti-corruption contract: a normalized observation carrying its raw payload
// and full provenance, provider-neutral.
// ---------------------------------------------------------------------------

export interface ProviderObservation {
  /** Provider key ('signal_bureau', 'native', …). */
  provider: string;
  /** The provider's own stable id for this record, if any. */
  providerRecordId: string | null;
  /** The provider schema version the adapter read (e.g. 'sb.signals.v1'). */
  providerSchemaVersion: string | null;
  observationType: string;
  title: string;
  summary: string | null;
  /** When the underlying event happened (ISO). */
  observedAt: string | null;
  /** The provider's own as-of stamp (ISO) — distinct from ingest time. */
  providerAsOf: string | null;
  evidenceStatus: EvidenceStatus;
  /** 0–1 provider-supplied confidence, normalized. */
  confidence: number;
  sourceUrls: string[];
  /** The provider payload, verbatim — incl. unknown fields — for provenance. */
  rawPayload: Record<string, unknown>;
  /** Names/aliases the adapter extracted, for entity resolution. */
  entityHints: EntityHint[];
  /** Optional provider-supplied expiry (ISO) — e.g. a future-event horizon. */
  expiresAt: string | null;
  /**
   * Provider trajectory NORMALIZED to a neutral band at the boundary. This is
   * ONE input, never the FundExecs relevance score. Original values stay in
   * rawPayload; the adapter maps them here so business logic never reads a
   * provider-specific trajectory field.
   */
  trajectory?: TrajectoryBand;
  /**
   * A neutral 0–100 urgency hint the adapter derives from trajectory + expiry
   * proximity, so the relevance engine gets time-pressure without knowing any
   * provider's proprietary velocity semantics.
   */
  urgencyHint?: number;
}

/** Provider-agnostic trajectory band. */
export type TrajectoryBand = "accelerating" | "steady" | "decelerating" | "unknown";

/** A name/identifier the provider associated with an observation. */
export interface EntityHint {
  name: string;
  entityType?: TrackedEntityType;
  /** The relationship the provider asserted, if any (verbatim). */
  providerRelationship?: string;
  /** Cross-system identifiers the provider supplied (ticker, CIK, …). */
  externalIdentifiers?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Canonical persisted records (mirror the migration rows).
// ---------------------------------------------------------------------------

export interface IntelligenceObservation {
  id: string;
  workspaceId: string; // organization_id
  provider: string;
  providerRecordId: string | null;
  providerSchemaVersion: string | null;
  observationType: string;
  title: string;
  summary: string | null;
  observedAt: string | null;
  providerAsOf: string | null;
  ingestedAt: string;
  freshnessStatus: FreshnessStatus;
  evidenceStatus: EvidenceStatus;
  confidence: number;
  sourceUrls: string[];
  rawPayload: Record<string, unknown>;
  contentHash: string;
  deduplicationKey: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TrackedEntity {
  id: string;
  workspaceId: string;
  entityType: TrackedEntityType;
  name: string;
  aliases: string[];
  description: string | null;
  externalIdentifiers: Record<string, string>;
  status: "active" | "muted" | "archived";
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MatchMethod = "exact" | "alias" | "external_id" | "inferred" | "manual";

export interface EntityObservationLink {
  id: string;
  workspaceId: string;
  observationId: string;
  entityId: string;
  matchMethod: MatchMethod;
  matchConfidence: number;
  providerRelationship: string | null;
  inferredRelationship: string | null;
  humanConfirmed: boolean;
}

export type ExposureType =
  | "fund"
  | "mandate"
  | "deal"
  | "pipeline_opportunity"
  | "portfolio_company"
  | "lp"
  | "capital_provider"
  | "lender"
  | "vendor"
  | "geography"
  | "sector"
  | "thesis"
  | "operating_initiative";

export interface Exposure {
  id: string;
  workspaceId: string;
  observationId: string | null;
  entityId: string | null;
  exposureType: ExposureType;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  exposureDirection: "positive" | "negative" | "neutral" | "mixed";
  exposureMagnitude: number;
  materiality: number;
  rationale: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export type TimeHorizon = "immediate" | "near_term" | "medium_term" | "long_term" | "unknown";

/** The separately-visible relevance dimensions — never collapsed to one number. */
export interface RelevanceDimensions {
  mandateRelevance: number;
  dealRelevance: number;
  portfolioRelevance: number;
  relationshipRelevance: number;
  regulatoryRelevance: number;
  materiality: number;
  urgency: number;
  confidence: number;
}

export interface IntelligenceAssessment extends RelevanceDimensions {
  id?: string;
  observationId: string;
  /** Composite the routing bar reads. Explained by scoreBreakdown. */
  actionability: number;
  potentialImpact: string | null;
  timeHorizon: TimeHorizon;
  /** Scenario implications, e.g. { bull, base, bear }. */
  implications: Record<string, string>;
  invalidators: string | null;
  monitoringCondition: string | null;
  recommendedAction: string | null;
  /** The specialist Earn should route this to. */
  assignedAgent: AgentKey | null;
  /** The gate tier the follow-on action requires (lib/gates.ts). */
  requiredTier: GateTier;
  /** The outward ActionKind the follow-on approval would authorize. */
  sendAction: ActionKind;
  /** Every dimension + weight that produced actionability — fully explainable. */
  scoreBreakdown: Record<string, unknown>;
  weightsVersion: string;
}

export type WatchlistScope = "workspace" | "fund" | "mandate" | "deal" | "portfolio" | "user";

export interface Watchlist {
  id: string;
  workspaceId: string;
  scopeType: WatchlistScope;
  scopeId: string | null;
  name: string;
  description: string | null;
  config: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Provider connection + the native provider interface.
// ---------------------------------------------------------------------------

export type ProviderConnectionStatus = "disabled" | "connected" | "error" | "revoked";
export type ProviderAuthMode = "none" | "rest" | "mcp";
export type ProviderHealth = "unknown" | "healthy" | "degraded" | "down";

export interface ProviderConnection {
  id: string;
  workspaceId: string;
  provider: string;
  label: string | null;
  status: ProviderConnectionStatus;
  authMode: ProviderAuthMode;
  config: Record<string, unknown>;
  featurePermissions: Record<string, boolean>;
  rateLimits: Record<string, number>;
  health: ProviderHealth;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
}

/** What a provider was asked to fetch on a sync. */
export interface FetchSpec {
  /** Optional entity names to scope the pull (from watchlists). */
  entities?: string[];
  /** Max observations to return this sync. */
  limit?: number;
  /** Only observations at/after this ISO instant. */
  since?: string;
}

/** A provider fetch result — best-effort, never throws to the caller. */
export interface FetchResult {
  observations: ProviderObservation[];
  /** Non-fatal issues (rate-limit backoff, partial page, schema drift). */
  warnings: string[];
  /** True when the provider surfaced fields the adapter did not recognize. */
  schemaDrift: boolean;
  /** True when data came from a degraded / cached path, not a live call. */
  degraded: boolean;
}

/**
 * The one interface every intelligence provider implements — the seam a new
 * source plugs into (mirrors lib/proactive/pmi PmiSource). Adapters return
 * normalized ProviderObservations; the ingestion pipeline owns persistence,
 * dedup, entity match, and assessment. Every method degrades rather than throws.
 */
export interface IntelligenceProvider {
  key: string;
  label: string;
  /** True when this workspace can actually reach the source (connection + creds). */
  available(workspaceId: string): Promise<boolean>;
  /** Pull the current feed (REST mode). Never throws. */
  fetchObservations(workspaceId: string, spec: FetchSpec): Promise<FetchResult>;
  /**
   * Future-event / scenario question (Signal Bureau `ask`). Optional — only for
   * providers that support forward-looking reasoning. Long-running; callers must
   * treat it as async and never for routine historical facts.
   */
  ask?(workspaceId: string, question: string): Promise<AskResult>;
  /** Provider-level trust/calibration metadata, if disclosed. */
  calibration?(workspaceId: string): Promise<ProviderCalibration | null>;
}

export interface AskResult {
  answer: string;
  evidenceStatus: EvidenceStatus;
  confidence: number;
  asOf: string | null;
  sourceUrls: string[];
  degraded: boolean;
}

/** Provider-disclosed calibration — informs trust metadata, never autonomy. */
export interface ProviderCalibration {
  /** 0–1 historical hit-rate the provider reports for its own signals. */
  reliability: number | null;
  /** Free-form methodology disclosure, preserved verbatim. */
  methodology: string | null;
  asOf: string | null;
}

/** The hub an assessment's assigned agent belongs to (for surfacing placement). */
export function hubForAgent(agent: AgentKey | null, agentHub: Record<AgentKey, Hub | null>): Hub | null {
  if (!agent) return null;
  return agentHub[agent] ?? null;
}
