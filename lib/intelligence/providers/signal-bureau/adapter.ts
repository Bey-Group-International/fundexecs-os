// lib/intelligence/providers/signal-bureau/adapter.ts
// The anti-corruption layer: SbSignal → ProviderObservation. Pure + tested.
//
//   SignalBureauPayload  →  ProviderObservation  →  IntelligenceObservation
//                (this file)          (ingest.ts persists)
//
// The adapter is the ONLY code that reads sb.signals.v1. It:
//   • preserves the original payload verbatim (rawPayload) + records the schema
//     version, so provenance survives and a replay is possible;
//   • normalizes timestamps, confidence scale, evidence status, and trajectory
//     to neutral shapes;
//   • distinguishes RECEIPTED evidence from UNRECEIPTED leads (never collapses);
//   • extracts entity hints for resolution;
//   • tolerates ADDITIVE schema changes — unknown fields are kept in rawPayload
//     and reported as schema drift, never a throw.

import type { EntityHint, EvidenceStatus, ProviderObservation, TrajectoryBand } from "@/lib/intelligence/types";
import { KNOWN_SB_SIGNAL_KEYS, SB_SCHEMA_VERSION, type SbSignal } from "./schema";

/** Coerce a value to a trimmed non-empty string, else null. */
function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

/** Normalize an ISO-ish timestamp; null if unparseable. Never throws. */
function isoOrNull(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Normalize confidence to 0–1, accepting either a 0–1 or a 0–100 provider scale. */
function normalizeConfidence(sb: SbSignal): number {
  const raw = typeof sb.confidence === "number" ? sb.confidence : typeof sb.score === "number" ? sb.score : null;
  if (raw == null || Number.isNaN(raw)) return 0;
  const v = raw > 1 ? raw / 100 : raw;
  return Math.max(0, Math.min(1, v));
}

/**
 * Evidence standing — the receipted/unreceipted distinction is load-bearing.
 * Explicit provider status wins; else receipts ⇒ receipted, corroborated flag ⇒
 * corroborated, nothing ⇒ unreceipted (a lead, shown as such). `unknown` only
 * when the provider actively declined to disclose.
 */
function normalizeEvidence(sb: SbSignal): EvidenceStatus {
  const explicit = str(sb.evidence_status)?.toLowerCase();
  if (explicit === "receipted" || explicit === "corroborated" || explicit === "unreceipted" || explicit === "unknown") {
    return explicit as EvidenceStatus;
  }
  if (sb.corroborated === true) return "corroborated";
  if (Array.isArray(sb.receipts) && sb.receipts.length > 0) return "receipted";
  if (Array.isArray(sb.sources) && sb.sources.length > 0) return "receipted";
  return "unreceipted";
}

/** Map a proprietary trajectory string/number to a neutral band. */
function normalizeTrajectory(sb: SbSignal): TrajectoryBand {
  const t = str(sb.trajectory)?.toLowerCase();
  if (t) {
    if (/(accel|rising|surg|spik|up)/.test(t)) return "accelerating";
    if (/(decel|falling|declin|cool|down)/.test(t)) return "decelerating";
    if (/(steady|stable|flat)/.test(t)) return "steady";
  }
  const v = typeof sb.velocity === "number" ? sb.velocity : typeof sb.acceleration === "number" ? sb.acceleration : null;
  if (v != null) {
    if (v > 0.15) return "accelerating";
    if (v < -0.15) return "decelerating";
    return "steady";
  }
  return "unknown";
}

/** A neutral 0–100 urgency hint from trajectory band + expiry proximity. */
function urgencyHint(band: TrajectoryBand, expiresAt: string | null, now: number): number {
  let base = band === "accelerating" ? 60 : band === "steady" ? 35 : band === "decelerating" ? 15 : 25;
  if (expiresAt) {
    const ms = Date.parse(expiresAt);
    if (!Number.isNaN(ms)) {
      const hours = (ms - now) / 3_600_000;
      // Closer horizons add urgency; a passed horizon is maximally urgent.
      if (hours <= 0) base += 30;
      else if (hours < 48) base += 25;
      else if (hours < 168) base += 12;
    }
  }
  return Math.max(0, Math.min(100, base));
}

/** Pull source links from receipts + convenience arrays, de-duplicated. */
function sourceUrls(sb: SbSignal): string[] {
  const urls = new Set<string>();
  for (const r of sb.receipts ?? []) {
    const u = str(r?.url);
    if (u) urls.add(u);
  }
  for (const u of sb.sources ?? []) {
    const s = str(u);
    if (s) urls.add(s);
  }
  for (const u of sb.urls ?? []) {
    const s = str(u);
    if (s) urls.add(s);
  }
  return [...urls];
}

/** Extract entity hints (primary entity + any co-mentioned entities). */
function entityHints(sb: SbSignal): EntityHint[] {
  const hints: EntityHint[] = [];
  const primary = str(sb.entity);
  if (primary) hints.push({ name: primary });
  for (const e of sb.entities ?? []) {
    if (typeof e === "string") {
      const n = str(e);
      if (n) hints.push({ name: n });
    } else if (e && typeof e === "object") {
      const n = str(e.name);
      if (n) {
        hints.push({
          name: n,
          providerRelationship: str(e.relationship) ?? undefined,
        });
      }
    }
  }
  // De-dupe by lowercased name, keeping the first (primary) occurrence.
  const seen = new Set<string>();
  return hints.filter((h) => {
    const k = h.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Unknown top-level keys on the signal — additive schema drift, non-fatal. */
export function detectDrift(sb: SbSignal): string[] {
  return Object.keys(sb).filter((k) => !KNOWN_SB_SIGNAL_KEYS.has(k));
}

export interface AdaptResult {
  observation: ProviderObservation | null;
  /** Unknown fields seen (schema drift). Empty when fully recognized. */
  drift: string[];
}

/**
 * Adapt one Signal Bureau signal into a neutral ProviderObservation. Returns a
 * null observation (with any drift) when the signal has no usable title AND no
 * entity — a malformed record is SKIPPED, never allowed to throw or to enter as
 * an empty observation.
 */
export function adaptSignal(sb: SbSignal, now: number = Date.now()): AdaptResult {
  const drift = detectDrift(sb);

  if (!sb || typeof sb !== "object") return { observation: null, drift };

  const hints = entityHints(sb);
  const title = str(sb.headline) ?? str(sb.title) ?? (hints[0] ? `Signal: ${hints[0].name}` : null);
  if (!title && hints.length === 0) return { observation: null, drift };

  const observedAt = isoOrNull(sb.observed_at) ?? isoOrNull(sb.detected_at);
  const providerAsOf = isoOrNull(sb.as_of);
  const expiresAt = isoOrNull(sb.expires_at) ?? isoOrNull(sb.horizon);
  const trajectory = normalizeTrajectory(sb);

  const observation: ProviderObservation = {
    provider: "signal_bureau",
    providerRecordId: str(sb.id),
    providerSchemaVersion: str(sb.schema_version) ?? SB_SCHEMA_VERSION,
    observationType: str(sb.signal_type) ?? str(sb.category) ?? "signal",
    title: title ?? `Signal: ${hints[0].name}`,
    summary: str(sb.summary) ?? str(sb.narrative),
    observedAt,
    providerAsOf,
    evidenceStatus: normalizeEvidence(sb),
    confidence: normalizeConfidence(sb),
    sourceUrls: sourceUrls(sb),
    rawPayload: { ...sb } as Record<string, unknown>, // verbatim, incl. unknown fields
    entityHints: hints,
    expiresAt,
    trajectory,
    urgencyHint: urgencyHint(trajectory, expiresAt, now),
  };

  return { observation, drift };
}

/** Adapt a page of signals, aggregating drift telemetry across the batch. */
export function adaptSignals(
  signals: SbSignal[],
  now: number = Date.now(),
): { observations: ProviderObservation[]; driftKeys: string[] } {
  const observations: ProviderObservation[] = [];
  const driftKeys = new Set<string>();
  for (const sb of signals ?? []) {
    const { observation, drift } = adaptSignal(sb, now);
    for (const d of drift) driftKeys.add(d);
    if (observation) observations.push(observation);
  }
  return { observations, driftKeys: [...driftKeys] };
}
