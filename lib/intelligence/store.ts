// lib/intelligence/store.ts
// Persistence for the intelligence core. Server-only, explicitly org-scoped.
// The tables are new, so (like lib/proactive/items.ts) we reach them through a
// narrow unknown-cast until the generated DB types are regenerated. Every read
// and write is filtered by organization_id — RLS is the backstop, not the only
// guard.

import type { createServiceClient } from "@/lib/supabase/server";
import { contentHash, deduplicationKey } from "./dedup";
import type {
  EntityObservationLink,
  IntelligenceAssessment,
  IntelligenceObservation,
  ProviderObservation,
  TrackedEntity,
} from "./types";
import type { EntityMatch } from "./entity-match";

type Db = ReturnType<typeof createServiceClient>;

function tbl(supabase: Db, name: string) {
  return (supabase as unknown as { from: (t: string) => ReturnType<Db["from"]> }).from(name);
}

// ---------------------------------------------------------------------------
// Tracked entities
// ---------------------------------------------------------------------------

interface EntityRow {
  id: string;
  organization_id: string;
  entity_type: string;
  name: string;
  aliases: string[] | null;
  description: string | null;
  external_identifiers: Record<string, string> | null;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function rowToEntity(r: EntityRow): TrackedEntity {
  return {
    id: r.id,
    workspaceId: r.organization_id,
    entityType: r.entity_type as TrackedEntity["entityType"],
    name: r.name,
    aliases: r.aliases ?? [],
    description: r.description,
    externalIdentifiers: r.external_identifiers ?? {},
    status: r.status as TrackedEntity["status"],
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** The active tracked-entity universe for a workspace (drives entity match). */
export async function listTrackedEntities(supabase: Db, workspaceId: string): Promise<TrackedEntity[]> {
  const { data, error } = await tbl(supabase, "tracked_entities")
    .select("*")
    .eq("organization_id", workspaceId)
    .neq("status", "archived");
  if (error || !data) return [];
  return (data as unknown as EntityRow[]).map(rowToEntity);
}

export async function createTrackedEntity(
  supabase: Db,
  input: {
    workspaceId: string;
    entityType: TrackedEntity["entityType"];
    name: string;
    aliases?: string[];
    description?: string;
    externalIdentifiers?: Record<string, string>;
    createdBy?: string | null;
  },
): Promise<TrackedEntity | null> {
  const { data, error } = await tbl(supabase, "tracked_entities")
    .insert({
      organization_id: input.workspaceId,
      entity_type: input.entityType,
      name: input.name,
      aliases: input.aliases ?? [],
      description: input.description ?? null,
      external_identifiers: input.externalIdentifiers ?? {},
      created_by: input.createdBy ?? null,
    })
    .select("*")
    .maybeSingle();
  if (error || !data) return null;
  return rowToEntity(data as unknown as EntityRow);
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

export interface UpsertObservationResult {
  id: string;
  contentHash: string;
  /** True when this content hash differs from what was previously stored. */
  changed: boolean;
}

/**
 * Upsert a normalized observation, deduplicated on (org, deduplication_key).
 * Idempotent: re-fetching the same signal updates in place (no duplicate row).
 * Returns whether the content changed, so callers can skip re-assessment of
 * unchanged observations.
 */
export async function upsertObservation(
  supabase: Db,
  workspaceId: string,
  obs: ProviderObservation,
  freshnessStatus: IntelligenceObservation["freshnessStatus"],
): Promise<UpsertObservationResult | null> {
  const hash = contentHash(obs);
  const dedupKey = deduplicationKey(obs, hash);

  // Look for an existing row to detect content change.
  const { data: existing } = await tbl(supabase, "intelligence_observations")
    .select("id,content_hash")
    .eq("organization_id", workspaceId)
    .eq("deduplication_key", dedupKey)
    .maybeSingle();
  const prior = existing as unknown as { id: string; content_hash: string } | null;

  const record = {
    organization_id: workspaceId,
    provider: obs.provider,
    provider_record_id: obs.providerRecordId,
    provider_schema_version: obs.providerSchemaVersion,
    observation_type: obs.observationType,
    title: obs.title,
    summary: obs.summary,
    observed_at: obs.observedAt,
    provider_as_of: obs.providerAsOf,
    freshness_status: freshnessStatus,
    evidence_status: obs.evidenceStatus,
    confidence: obs.confidence,
    source_urls: obs.sourceUrls,
    raw_payload: obs.rawPayload,
    content_hash: hash,
    deduplication_key: dedupKey,
    expires_at: obs.expiresAt,
  };

  const { data, error } = await tbl(supabase, "intelligence_observations")
    .upsert(record, { onConflict: "organization_id,deduplication_key" })
    .select("id")
    .maybeSingle();
  if (error || !data) return null;
  const id = (data as unknown as { id: string }).id;
  return { id, contentHash: hash, changed: !prior || prior.content_hash !== hash };
}

interface ObservationRow {
  id: string;
  organization_id: string;
  provider: string;
  provider_record_id: string | null;
  provider_schema_version: string | null;
  observation_type: string;
  title: string;
  summary: string | null;
  observed_at: string | null;
  provider_as_of: string | null;
  ingested_at: string;
  freshness_status: string;
  evidence_status: string;
  confidence: number;
  source_urls: string[] | null;
  raw_payload: Record<string, unknown> | null;
  content_hash: string;
  deduplication_key: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToObservation(r: ObservationRow): IntelligenceObservation {
  return {
    id: r.id,
    workspaceId: r.organization_id,
    provider: r.provider,
    providerRecordId: r.provider_record_id,
    providerSchemaVersion: r.provider_schema_version,
    observationType: r.observation_type,
    title: r.title,
    summary: r.summary,
    observedAt: r.observed_at,
    providerAsOf: r.provider_as_of,
    ingestedAt: r.ingested_at,
    freshnessStatus: r.freshness_status as IntelligenceObservation["freshnessStatus"],
    evidenceStatus: r.evidence_status as IntelligenceObservation["evidenceStatus"],
    confidence: r.confidence,
    sourceUrls: r.source_urls ?? [],
    rawPayload: r.raw_payload ?? {},
    contentHash: r.content_hash,
    deduplicationKey: r.deduplication_key,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Recent observations for a workspace — the read model for the operating brief
 * and hub surfaces. Returns last-known-good rows even when a provider is down,
 * so a provider outage never blocks access to stored intelligence.
 */
export async function listRecentObservations(
  supabase: Db,
  workspaceId: string,
  limit = 50,
): Promise<IntelligenceObservation[]> {
  const { data, error } = await tbl(supabase, "intelligence_observations")
    .select("*")
    .eq("organization_id", workspaceId)
    .order("ingested_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as unknown as ObservationRow[]).map(rowToObservation);
}

// ---------------------------------------------------------------------------
// Entity links
// ---------------------------------------------------------------------------

/** Replace the entity links for an observation with the current match set. */
export async function replaceEntityLinks(
  supabase: Db,
  workspaceId: string,
  observationId: string,
  matches: EntityMatch[],
): Promise<void> {
  await tbl(supabase, "entity_observation_links")
    .delete()
    .eq("organization_id", workspaceId)
    .eq("observation_id", observationId);
  if (matches.length === 0) return;
  const rows = matches.map((m) => ({
    organization_id: workspaceId,
    observation_id: observationId,
    entity_id: m.entity.id,
    match_method: m.method,
    match_confidence: m.confidence,
    provider_relationship: m.providerRelationship,
  }));
  await tbl(supabase, "entity_observation_links").insert(rows);
}

// ---------------------------------------------------------------------------
// Exposures
// ---------------------------------------------------------------------------

export interface ExposureRecord {
  exposureType: string;
  entityId: string | null;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  exposureDirection: string;
  exposureMagnitude: number;
  materiality: number;
  rationale: string | null;
}

/** Replace the derived exposures for an observation. */
export async function replaceExposures(
  supabase: Db,
  workspaceId: string,
  observationId: string,
  exposures: ExposureRecord[],
): Promise<void> {
  await tbl(supabase, "intelligence_exposures")
    .delete()
    .eq("organization_id", workspaceId)
    .eq("observation_id", observationId);
  if (exposures.length === 0) return;
  const rows = exposures.map((e) => ({
    organization_id: workspaceId,
    observation_id: observationId,
    entity_id: e.entityId,
    exposure_type: e.exposureType,
    target_type: e.targetType,
    target_id: e.targetId,
    target_name: e.targetName,
    exposure_direction: e.exposureDirection,
    exposure_magnitude: e.exposureMagnitude,
    materiality: e.materiality,
    rationale: e.rationale,
  }));
  await tbl(supabase, "intelligence_exposures").insert(rows);
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

/** Upsert FundExecs' assessment of an observation (one per observation). */
export async function upsertAssessment(
  supabase: Db,
  workspaceId: string,
  a: IntelligenceAssessment,
): Promise<void> {
  const record = {
    organization_id: workspaceId,
    observation_id: a.observationId,
    mandate_relevance: a.mandateRelevance,
    deal_relevance: a.dealRelevance,
    portfolio_relevance: a.portfolioRelevance,
    relationship_relevance: a.relationshipRelevance,
    regulatory_relevance: a.regulatoryRelevance,
    materiality: a.materiality,
    urgency: a.urgency,
    confidence: a.confidence,
    actionability: a.actionability,
    potential_impact: a.potentialImpact,
    time_horizon: a.timeHorizon,
    implications: a.implications,
    invalidators: a.invalidators,
    monitoring_condition: a.monitoringCondition,
    recommended_action: a.recommendedAction,
    assigned_agent: a.assignedAgent,
    required_tier: a.requiredTier,
    score_breakdown: a.scoreBreakdown,
    weights_version: a.weightsVersion,
  };
  await tbl(supabase, "intelligence_assessments").upsert(record, { onConflict: "observation_id" });
}
