// lib/proactive/pmi/types.ts
// Private Market Intelligence (PMI) — the source registry contract.
//
// A pluggable intelligence-source registry mirroring the trigger registry: each
// source sits behind ONE common interface (query / enrich / benchmark) so new
// sources are added by config, not code. Every source returns the standard
// VerifiedResult<T> envelope (lib/source-hub-types.ts) so provenance — source,
// as-of date, confidence — is mandatory and uniform. Caching + staleness are
// enforced by the registry wrapper (registry.ts), not each source.

import type { VerifiedResult } from "@/lib/source-hub-types";
import type { ProvenancedClaim } from "@/lib/proactive/types";

/** A benchmark metric pulled from a source's peer-cohort dataset. */
export interface PmiBenchmark {
  /** e.g. "dpi" | "tvpi" | "net_irr" | "nav" | "mgmt_fee". */
  metric: string;
  /** The subject fund/firm's value for the metric. */
  value: number;
  unit: "x" | "pct" | "usd";
  /** Percentile of `value` within the cohort, 0–100 (higher = better). */
  percentile: number | null;
  /** Human label of the peer cohort, e.g. "2021 vintage, sub-$100M buyout". */
  cohort: string;
  asOf: string;
}

/** Enrichment about a subject (an LP, a target company) from a source. */
export interface PmiEnrichment {
  subject: string;
  /** Discrete facts, each already provenance-carrying for the draft to cite. */
  facts: ProvenancedClaim[];
}

export interface BenchmarkSpec {
  metric: string;
  /** Cohort selectors — vintage, strategy, size band, sector. */
  cohort?: Record<string, string | number>;
}

export interface EnrichSpec {
  subjectType: "investor" | "company" | "fund";
  subjectName: string;
  /** Sector / strategy context to scope the enrichment. */
  context?: Record<string, string | number>;
}

/**
 * The one interface every PMI source implements. Sources are registered in
 * registry.ts; adding Datasite/Apollo/etc. is implementing this + one line of
 * config. Each method degrades to a `failed` VerifiedResult rather than throwing
 * — PMI is best-effort and must never break a sweep.
 */
export interface PmiSource {
  key: string;
  label: string;
  /** True when this org can actually reach the source (creds/connection). */
  available(orgId: string): Promise<boolean>;
  benchmark(orgId: string, spec: BenchmarkSpec): Promise<VerifiedResult<PmiBenchmark>>;
  enrich(orgId: string, spec: EnrichSpec): Promise<VerifiedResult<PmiEnrichment>>;
  /** Free-form read for anything the typed methods don't cover. */
  query?(orgId: string, spec: Record<string, unknown>): Promise<VerifiedResult<unknown>>;
}

/** Turn a VerifiedResult into provenance-carrying claims for a draft. */
export function benchmarkToClaim(r: VerifiedResult<PmiBenchmark>): ProvenancedClaim | null {
  if (r.status === "failed" || !r.data) return null;
  const b = r.data;
  const pct =
    b.percentile != null
      ? `${b.unit === "x" ? b.value.toFixed(2) + "x" : b.value}${
          b.percentile >= 75 ? ` — top-quartile (P${Math.round(b.percentile)})` : ` (P${Math.round(b.percentile)})`
        } vs ${b.cohort}`
      : `${b.value}${b.unit === "x" ? "x" : ""} (${b.cohort})`;
  const src = r.sources[0];
  return {
    claim: `${b.metric.toUpperCase()} ${pct}`,
    source: src?.provider ?? "unknown",
    asOf: b.asOf,
    confidence: r.confidence,
    verified: r.verified,
    ref: src?.endpoint,
  };
}
