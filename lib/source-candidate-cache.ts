// lib/source-candidate-cache.ts
// Short-TTL caching for AI-generated sourcing candidates.
//
// Generation is the slowest thing the Source hub does: a model call, optionally
// preceded by a web-search round trip. Operators refine the same request several
// times in a sitting ("family offices in Texas" → "...that back first-time
// managers"), and a multi-step plan re-enters the same module. Caching the
// candidate set behind an exact-input key turns the repeat into a read.
//
// The key covers everything that can change the answer — module, mandate,
// query, enrichment mode, and a fingerprint of what's already in the pipeline —
// so a cache hit is only ever returned for a genuinely identical request. The
// TTL is deliberately short (30 min) because sourcing output should feel live,
// and every caller can force a miss with `refresh`.
import { createHash } from "crypto";
import { getCached, setCached } from "@/lib/source-cache";
import type { OperatorContext, SourcingMandate } from "@/lib/source-ai";
import type { VerifiedCandidate } from "@/lib/source-verification";
import type { ScoredCandidate } from "@/lib/source-fit";
import type { VerifiedResult } from "@/lib/source-hub-types";

/** Cache module bucket — keeps candidate rows separate from provider lookups. */
const MODULE = "candidates";
const PROVIDER = "source_ai";

/** 30 minutes: long enough to absorb a refine-and-retry loop, short enough to feel live. */
export const CANDIDATE_TTL_SECONDS = 1800;

export interface CandidateCacheKey {
  /** Full module key, e.g. "source/lp_pipeline". */
  module: string;
  mandate: SourcingMandate | null;
  query?: string;
  /** Names already in the pipeline — changes here must invalidate. */
  existing: string[];
  /** Web-search enrichment changes the answer, so it's part of the key. */
  enriched: boolean;
  /**
   * The per-operator context generation reasons with — learned preferences,
   * recent activity, portfolio, identity.
   *
   * This belongs in the key because `generateTargets` is given it. Without it,
   * two operators in one organization with opposite learned preferences share
   * a cache entry and one of them silently receives the other's personalized
   * results; a fresh accept/reject signal would also leave the digest it
   * changed unused for the life of the entry.
   */
  context?: OperatorContext;
}

/** Order-independent digest of the pipeline names, so row order can't miss the cache. */
function existingFingerprint(names: string[]): string {
  if (!names.length) return "none";
  const sorted = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))].sort();
  return createHash("sha256").update(sorted.join("|")).digest("hex").slice(0, 16) + `:${sorted.length}`;
}

/**
 * Digest of the operator context. The context is already distilled to short
 * strings, so hashing them is a faithful fingerprint: any change to what the
 * engine is told produces a different key.
 */
function contextFingerprint(context?: OperatorContext): string {
  if (!context) return "none";
  const parts = [context.user, context.portfolio, context.activity, context.learned];
  if (parts.every((p) => !p)) return "none";
  return createHash("sha256").update(parts.map((p) => p ?? "").join("\u0000")).digest("hex").slice(0, 16);
}

function keyParams(key: CandidateCacheKey): Record<string, unknown> {
  const m = key.mandate;
  return {
    context: contextFingerprint(key.context),
    module: key.module,
    query: (key.query ?? "").trim().toLowerCase(),
    enriched: key.enriched,
    existing: existingFingerprint(key.existing),
    thesis: m?.thesisTitle ?? null,
    assetClasses: [...(m?.assetClasses ?? [])].sort().join(","),
    geographies: [...(m?.geographies ?? [])].sort().join(","),
    checkMin: m?.checkSizeMin ?? null,
    checkMax: m?.checkSizeMax ?? null,
    targetIrr: m?.targetIrr ?? null,
    targetMoic: m?.targetMoic ?? null,
  };
}

/**
 * What the cache round-trips. The fit breakdown is optional on read because an
 * entry written before deterministic scoring existed won't carry it; callers
 * pass the set through `ensureMandateFit` to fill that in.
 */
export type CachedCandidate = VerifiedCandidate & Partial<ScoredCandidate>;

export interface CachedCandidates {
  candidates: CachedCandidate[];
  /** True when these came back from cache rather than a fresh generation. */
  cached: boolean;
  /** When the cached set was generated (ISO), for the UI's freshness line. */
  cachedAt?: string;
}

/** Read a cached candidate set, or null on a miss / when refresh is requested. */
export async function getCachedCandidates(
  orgId: string,
  key: CandidateCacheKey,
  refresh = false,
): Promise<CachedCandidates | null> {
  if (refresh) return null;
  const hit = await getCached<CachedCandidate[]>(orgId, MODULE, PROVIDER, keyParams(key));
  const candidates = hit?.data;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return { candidates, cached: true, cachedAt: hit?.cache?.cached_at };
}

/** Store a freshly generated candidate set. Best-effort — never throws. */
export async function setCachedCandidates(
  orgId: string,
  key: CandidateCacheKey,
  candidates: CachedCandidate[],
): Promise<void> {
  if (!candidates.length) return; // never cache an empty result
  const envelope: VerifiedResult<CachedCandidate[]> = {
    status: "success",
    // These candidates have been through lib/source-verification; the envelope
    // reports what that pass concluded rather than a fixed guess.
    verified: candidates.every((c) => c.verification.status === "verified"),
    confidence: Number(
      (candidates.reduce((sum, c) => sum + c.verification.confidence, 0) / candidates.length).toFixed(2),
    ),
    timestamp: new Date().toISOString(),
    sources: [
      {
        provider: PROVIDER,
        endpoint: key.module,
        latency_ms: 0,
        verified: false,
        retrieved_at: new Date().toISOString(),
      },
    ],
    data: candidates,
  };
  await setCached(orgId, MODULE, PROVIDER, keyParams(key), envelope, CANDIDATE_TTL_SECONDS);
}

export const __test = { existingFingerprint, contextFingerprint, keyParams, MODULE, PROVIDER };
