// lib/intelligence/ingest.ts
// The ingestion pipeline — the one place a provider feed becomes native records.
// Server-only, best-effort, org-scoped. A provider outage or a bad page NEVER
// throws to the caller and NEVER blocks access to already-stored intelligence.
//
//   fetch (provider) → adapt (already normalized) → freshness → dedup+persist →
//   entity match → exposures → assessment (relevance + routing) → link back
//
// This deliberately does NOT trigger any outward action. It stops at a persisted
// assessment carrying an assigned agent + required gate tier; the Earn loop +
// gate layer (lib/gates.ts) own everything downstream. External intelligence
// initiates analysis, never final action.

import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import type { FreshnessStatus, IntelligenceProvider } from "./types";
import { capabilityEnabled, coreEnabled } from "./flags";
import { getIntelligenceProvider } from "./provider";
import { matchEntities } from "./entity-match";
import { buildAssessment } from "./assess";
import {
  listTrackedEntities,
  replaceEntityLinks,
  replaceExposures,
  upsertAssessment,
  upsertObservation,
} from "./store";
import { recordSyncOutcome } from "./connections";

// Per-provider freshness TTLs (seconds), mirroring lib/proactive/config PMI TTLs.
const FRESHNESS_TTL: Record<string, { fresh: number; aging: number }> = {
  signal_bureau: { fresh: 21_600, aging: 86_400 }, // fresh <6h, aging <24h, else stale
  default: { fresh: 21_600, aging: 86_400 },
};

/** Freshness verdict for an observation's own as-of date. */
export function freshnessFor(
  provider: string,
  asOf: string | null,
  now: number = Date.now(),
): FreshnessStatus {
  if (!asOf) return "aging"; // undisclosed as-of is never treated as fresh.
  const ms = Date.parse(asOf);
  if (Number.isNaN(ms)) return "aging";
  const ttl = FRESHNESS_TTL[provider] ?? FRESHNESS_TTL.default;
  const ageSec = Math.max(0, (now - ms) / 1000);
  if (ageSec <= ttl.fresh) return "fresh";
  if (ageSec <= ttl.aging) return "aging";
  return "stale";
}

export interface IngestSummary {
  provider: string;
  fetched: number;
  persisted: number;
  assessed: number;
  schemaDrift: boolean;
  degraded: boolean;
  warnings: string[];
}

/**
 * Ingest a single provider for a single workspace. Requires the core flag, the
 * provider flag, service env, and an available connection — otherwise returns a
 * no-op degraded summary (never throws).
 */
export async function ingestProvider(
  workspaceId: string,
  providerKey: string,
  opts: { limit?: number; since?: string; now?: number } = {},
): Promise<IngestSummary> {
  const base: IngestSummary = {
    provider: providerKey,
    fetched: 0,
    persisted: 0,
    assessed: 0,
    schemaDrift: false,
    degraded: true,
    warnings: [],
  };

  if (!coreEnabled()) return { ...base, warnings: ["intelligence_core disabled"] };
  if (!hasSupabaseServiceEnv()) return { ...base, warnings: ["service env unavailable"] };

  const provider: IntelligenceProvider | null = getIntelligenceProvider(providerKey);
  if (!provider) return { ...base, warnings: [`unknown provider: ${providerKey}`] };
  // Provider capability flags are checked inside the provider; a disabled or
  // unconnected provider simply returns an empty degraded fetch.
  if (providerKey === "signal_bureau" && !capabilityEnabled("provider_signal_bureau")) {
    return { ...base, warnings: ["provider_signal_bureau disabled"] };
  }

  const supabase = createServiceClient();
  const now = opts.now ?? Date.now();

  let fetch;
  try {
    fetch = await provider.fetchObservations(workspaceId, { limit: opts.limit ?? 50, since: opts.since });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "provider fetch threw";
    await recordSyncOutcome(supabase, workspaceId, providerKey, { ok: false, error: msg });
    return { ...base, warnings: [msg] };
  }

  const summary: IngestSummary = {
    ...base,
    fetched: fetch.observations.length,
    schemaDrift: fetch.schemaDrift,
    degraded: fetch.degraded,
    warnings: [...fetch.warnings],
  };

  if (fetch.observations.length === 0) {
    await recordSyncOutcome(supabase, workspaceId, providerKey, {
      ok: !fetch.degraded,
      error: fetch.degraded ? fetch.warnings[0] ?? "degraded" : undefined,
    });
    return summary;
  }

  // Load the tracked-entity universe once for the whole batch.
  const universe = await listTrackedEntities(supabase, workspaceId);

  for (const obs of fetch.observations) {
    const freshness = freshnessFor(providerKey, obs.providerAsOf ?? obs.observedAt, now);
    const up = await upsertObservation(supabase, workspaceId, obs, freshness);
    if (!up) {
      summary.warnings.push(`failed to persist "${obs.title}"`);
      continue;
    }
    summary.persisted += 1;

    // Skip re-assessment of unchanged observations (idempotent + cheap).
    if (!up.changed) continue;

    const matches = matchEntities(obs.entityHints, universe);
    await replaceEntityLinks(supabase, workspaceId, up.id, matches);

    const { assessment, exposures } = buildAssessment(up.id, obs, matches, freshness);
    await replaceExposures(supabase, workspaceId, up.id, exposures);
    await upsertAssessment(supabase, workspaceId, assessment);
    summary.assessed += 1;
  }

  await recordSyncOutcome(supabase, workspaceId, providerKey, {
    ok: !fetch.degraded,
    error: fetch.degraded ? fetch.warnings[0] ?? "degraded" : undefined,
  });
  return summary;
}
