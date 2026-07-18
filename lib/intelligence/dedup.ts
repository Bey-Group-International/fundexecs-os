// lib/intelligence/dedup.ts
// Deterministic content hashing + dedup keys for observations. Pure + tested.
//
// Two jobs:
//   contentHash(obs)      — a stable sha256 over the NORMALIZED content, so the
//                           same observation re-fetched produces the same hash,
//                           and a genuine change (title/summary/as-of) produces
//                           a different one. Drives change detection.
//   deduplicationKey(obs) — the per-org idempotency key the DB unique index
//                           enforces. Prefer the provider's own record id
//                           (provider + id); fall back to the content hash when
//                           the provider gives no stable id.
//
// Mirrors lib/source-cache.hashQuery (sha256 of sorted, stable-stringified
// input) so hashing is consistent across the codebase.

import { createHash } from "crypto";
import type { ProviderObservation } from "./types";

/** Stable JSON: object keys sorted recursively so key order never changes the hash. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * The content-identity of an observation. Deliberately EXCLUDES volatile fields
 * (ingest time, freshness) and the full raw payload, hashing only the meaning-
 * bearing content so a re-fetch of the same signal is recognized as identical
 * while a real edit changes the hash.
 */
export function contentHash(obs: ProviderObservation): string {
  const canonical = {
    provider: obs.provider,
    providerRecordId: obs.providerRecordId ?? null,
    observationType: obs.observationType,
    title: obs.title.trim(),
    summary: (obs.summary ?? "").trim(),
    observedAt: obs.observedAt ?? null,
    providerAsOf: obs.providerAsOf ?? null,
    evidenceStatus: obs.evidenceStatus,
    sourceUrls: [...obs.sourceUrls].sort(),
    entityHints: [...obs.entityHints]
      .map((h) => h.name.trim().toLowerCase())
      .sort(),
  };
  return createHash("sha256").update(stableStringify(canonical)).digest("hex");
}

/**
 * The per-org idempotency key. A provider record id makes two fetches of the
 * same underlying record collide (so an UPDATE, not a duplicate INSERT). Without
 * one, the content hash is the key — an identical re-fetch dedups, a changed one
 * inserts a new observation (which is correct: it is genuinely new content).
 */
export function deduplicationKey(obs: ProviderObservation, hash: string): string {
  if (obs.providerRecordId) return `${obs.provider}:${obs.providerRecordId}`;
  return `${obs.provider}:hash:${hash}`;
}
