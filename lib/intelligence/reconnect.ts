/* ============================================================================
 * lib/intelligence/reconnect.ts — the FundExecs Relationship Reconnect Engine.
 *
 * A proprietary, key-free signal: which durable relationships are going cold and
 * should be re-engaged now. It deliberately does NOT rank by current
 * `relationships.strength` — that score already decays with recency, so a strong
 * relationship that lapses simply fades from view. Instead it pairs the
 * non-decaying *depth* of a relationship (how many times you've actually
 * interacted) with its *staleness* (days since last touch): a deep relationship
 * left untouched is exactly what an operator should reconnect before it decays.
 *
 * Pure + total — no DB, no model, trivially unit-testable.
 * ========================================================================= */

/** Minimal contact shape — a structural subset of ConnectionRow. */
export interface ReconnectInput {
  id: string;
  fullName: string;
  company: string | null;
  /** relationships.strength (0–100), shown for context only. */
  strength: number;
  status: string;
  /** Durable depth signal — total interactions to date. */
  interactionCount: number;
  /** ISO timestamp of the last interaction, or null if never recorded. */
  lastInteractionAt: string | null;
}

export type ReconnectBand = 'Overdue' | 'Due soon' | 'Healthy';

export interface ReconnectResult {
  id: string;
  fullName: string;
  company: string | null;
  strength: number;
  /** Days since the last interaction (null when never recorded). */
  daysSince: number | null;
  /** 0–100 reconnect priority (depth × staleness). */
  priority: number;
  band: ReconnectBand;
  /** Human-readable evidence. */
  reason: string;
}

/** Interactions at/above this count are treated as a "deep" relationship. */
const DEPTH_SATURATION = 20;
/** Staleness ramps from this many days (no urgency) … */
const STALE_FLOOR_DAYS = 14;
/** … up to this many days (fully stale). */
const STALE_CEIL_DAYS = 120;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function bandFor(priority: number): ReconnectBand {
  if (priority >= 60) return 'Overdue';
  if (priority >= 30) return 'Due soon';
  return 'Healthy';
}

/**
 * Score a single relationship's reconnect priority. `now` is injectable for tests.
 */
export function computeReconnect(input: ReconnectInput, now: number = Date.now()): ReconnectResult {
  const count = Math.max(0, Math.floor(input.interactionCount || 0));
  const depth = clamp01(Math.min(count, DEPTH_SATURATION) / DEPTH_SATURATION);

  const t = input.lastInteractionAt ? Date.parse(input.lastInteractionAt) : NaN;
  const daysSince = Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null;

  // Staleness 0→1 across the floor→ceiling window. A relationship with history
  // but no recorded touch is treated as fully stale.
  const staleness =
    daysSince === null
      ? count > 0
        ? 1
        : 0
      : clamp01((daysSince - STALE_FLOOR_DAYS) / (STALE_CEIL_DAYS - STALE_FLOOR_DAYS));

  const priority = Math.round(depth * staleness * 100);

  const reason =
    daysSince === null
      ? `${count} interaction${count === 1 ? '' : 's'}, no recent contact logged`
      : `${count} interaction${count === 1 ? '' : 's'}, last touch ${daysSince} day${daysSince === 1 ? '' : 's'} ago`;

  return {
    id: input.id,
    fullName: input.fullName,
    company: input.company,
    strength: input.strength,
    daysSince,
    priority,
    band: bandFor(priority),
    reason
  };
}

/**
 * Rank a set of relationships by reconnect priority, keeping only those that
 * actually need attention (Due soon + Overdue), highest first.
 */
export function rankReconnects(
  inputs: ReconnectInput[],
  now: number = Date.now()
): ReconnectResult[] {
  return inputs
    .map((i) => computeReconnect(i, now))
    .filter((r) => r.band !== 'Healthy')
    .sort((a, b) => b.priority - a.priority);
}
