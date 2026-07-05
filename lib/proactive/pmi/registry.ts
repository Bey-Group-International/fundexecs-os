// lib/proactive/pmi/registry.ts
// The PMI source registry — the pluggable seam. Carta is wired end-to-end;
// every other source is scaffolded behind the SAME interface so adding it is
// implementing one object and registering it here (config, not new plumbing).
//
// This module also owns the cross-cutting concerns the task mandates for the
// whole layer: caching (reuse lib/source-cache), rate-limit friendliness (cache
// hits avoid re-calls), and STALENESS — intelligence older than its per-source
// TTL is downgraded so it can never silently enter a live investor draft.

import { getCached, setCached } from "@/lib/source-cache";
import type { VerifiedResult } from "@/lib/source-hub-types";
import { PMI_TTL_SECONDS } from "@/lib/proactive/config";
import type { PmiSource, PmiBenchmark, BenchmarkSpec } from "./types";
import { cartaSource } from "./carta.server";

/** A source that is registered but not yet implemented — honest, never faked. */
function scaffold(key: string, label: string): PmiSource {
  const notReady = <T>(): VerifiedResult<T> => ({
    status: "failed",
    verified: false,
    confidence: 0,
    timestamp: new Date().toISOString(),
    sources: [],
    data: null as unknown as T,
    errors: [`${label} PMI source is scaffolded but not yet connected.`],
  });
  return {
    key,
    label,
    async available() {
      return false;
    },
    async benchmark() {
      return notReady<PmiBenchmark>();
    },
    async enrich() {
      return notReady();
    },
  };
}

/**
 * The registry. Carta is live-capable; the rest are scaffolded seams mapped to
 * their intended use (Apollo = LP/company enrichment, Datasite = deal-room,
 * CourtListener = legal diligence, Semrush = web traction, Day AI = CRM).
 */
export const PMI_SOURCES: Record<string, PmiSource> = {
  carta: cartaSource,
  apollo: scaffold("apollo", "Apollo"),
  datasite: scaffold("datasite", "Datasite"),
  courtlistener: scaffold("courtlistener", "CourtListener"),
  semrush: scaffold("semrush", "Semrush"),
  dayai: scaffold("dayai", "Day AI"),
};

export function getPmiSource(key: string): PmiSource | null {
  return PMI_SOURCES[key] ?? null;
}

/**
 * Decide whether an intelligence value is stale. Pure + tested. `asOf` is the
 * data's own as-of date; anything older than the source TTL is stale and must
 * be flagged so it does not enter a live draft unqualified.
 */
export function assessStaleness(
  asOf: string,
  source: string,
  now: number = Date.now(),
): { stale: boolean; ageSeconds: number; ttlSeconds: number } {
  const ttlSeconds = PMI_TTL_SECONDS[source] ?? PMI_TTL_SECONDS.default;
  const asOfMs = Date.parse(asOf);
  const ageSeconds = Number.isNaN(asOfMs) ? Infinity : Math.max(0, (now - asOfMs) / 1000);
  return { stale: ageSeconds > ttlSeconds, ageSeconds, ttlSeconds };
}

/** Downgrade a result whose underlying data is stale, so it can't ride into a draft as fresh. */
function applyStaleness(r: VerifiedResult<PmiBenchmark>, now: number): VerifiedResult<PmiBenchmark> {
  if (r.status === "failed" || !r.data) return r;
  const s = assessStaleness(r.data.asOf, r.sources[0]?.provider ?? "default", now);
  if (!s.stale) return r;
  return {
    ...r,
    status: "warning",
    verified: false,
    confidence: Math.min(r.confidence, 0.3),
    errors: [
      ...(r.errors ?? []),
      `Data stale: ${Math.round(s.ageSeconds / 3600)}h old exceeds ${Math.round(s.ttlSeconds / 3600)}h TTL.`,
    ],
  };
}

/**
 * Fetch a benchmark through the registry with caching + staleness applied.
 * Cache hits avoid re-calling the external API; a stale value (by its own as-of
 * date) is downgraded. Best-effort caching: a cache backend miss never fails.
 */
export async function benchmarkWithCache(
  orgId: string,
  sourceKey: string,
  spec: BenchmarkSpec,
  now: number = Date.now(),
): Promise<VerifiedResult<PmiBenchmark>> {
  const source = getPmiSource(sourceKey);
  if (!source) {
    return {
      status: "failed",
      verified: false,
      confidence: 0,
      timestamp: new Date().toISOString(),
      sources: [],
      data: null as unknown as PmiBenchmark,
      errors: [`Unknown PMI source: ${sourceKey}`],
    };
  }

  const cacheParams = { kind: "benchmark", ...spec };
  const cached = await getCached<PmiBenchmark>(orgId, "signals", sourceKey, cacheParams);
  if (cached && cached.status !== "failed") return applyStaleness(cached, now);

  const fresh = await source.benchmark(orgId, spec);
  if (fresh.status !== "failed") {
    const ttl = PMI_TTL_SECONDS[sourceKey] ?? PMI_TTL_SECONDS.default;
    await setCached(orgId, "signals", sourceKey, cacheParams, fresh, ttl);
  }
  return applyStaleness(fresh, now);
}
