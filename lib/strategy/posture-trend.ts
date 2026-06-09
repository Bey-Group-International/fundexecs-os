/* ============================================================================
 * lib/strategy/posture-trend.ts — momentum Δ, streak, and peer percentile over
 * the org_posture_snapshots history (pure, no I/O — tested like lib/lifecycle.ts).
 *
 * Phase 3 (snapshot-backed half) of memory/STRATEGY_COMPOUNDING_BLUEPRINT.md.
 * Where lib/strategy/posture.ts computes a single live composite, this module
 * reads the persisted snapshot trail to answer "which way am I moving, for how
 * long, and where do I sit against my peers?".
 *
 * Guardrail (carried from the blueprint): NEVER fabricate a Δ, streak, or rank.
 * Every function degrades to null/empty when the data isn't there — a one-point
 * history has no Δ; a cohort below the privacy floor has no percentile.
 * ========================================================================= */

/** The privacy floor: a peer percentile is withheld below this cohort size. */
export const PEER_COHORT_FLOOR = 5;

/** One persisted posture snapshot, reduced to what the trend reads. */
export interface PostureSnapshot {
  /** UTC date (YYYY-MM-DD). */
  date: string;
  /** 0–100 weighted composite that day. */
  composite: number;
}

/** Weekly momentum: latest composite vs. the prior snapshot. */
export interface PostureMomentum {
  /** Composite of the most recent snapshot. */
  current: number;
  /** Points changed vs. the immediately prior snapshot (latest − prior). */
  delta: number;
  /** Direction of travel. */
  direction: 'up' | 'down' | 'flat';
  /**
   * Consecutive snapshots (counting back from latest) where the composite did
   * not fall — the "streak" of held-or-improved posture. 1 when there's a single
   * point; grows while each step is ≥ the one before it.
   */
  streak: number;
}

/** A peer percentile, only ever populated when the cohort clears the floor. */
export interface PosturePercentile {
  /** 0–100: the share of the cohort at or below this org's composite. */
  percentile: number;
  /** Cohort size the rank is computed over (always ≥ {@link PEER_COHORT_FLOOR}). */
  cohortSize: number;
}

/**
 * Weekly momentum + streak from the snapshot trail. Returns null when there's
 * no snapshot at all (nothing to report) — and a single snapshot yields a
 * delta of 0 with a streak of 1, never a fabricated movement.
 *
 * `snapshots` may be in any order; the two most recent by date drive the Δ, and
 * the streak walks backward from the latest while the composite holds or rises.
 */
export function computePostureMomentum(snapshots: PostureSnapshot[]): PostureMomentum | null {
  if (snapshots.length === 0) return null;

  // Newest → oldest, so index 0 is the latest snapshot.
  const ordered = [...snapshots].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const current = ordered[0].composite;

  const delta = ordered.length >= 2 ? current - ordered[1].composite : 0;
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';

  // Streak: consecutive steps (newest backward) where each value held or rose
  // relative to the older neighbour. A drop breaks it.
  let streak = 1;
  for (let i = 0; i + 1 < ordered.length; i++) {
    if (ordered[i].composite >= ordered[i + 1].composite) streak++;
    else break;
  }

  return { current, delta, direction, streak };
}

/**
 * Peer percentile of `orgComposite` within a cohort of peer composites (same
 * stage / member type, supplied by the caller). Returns null — never a
 * fabricated rank — when the cohort (including this org) is below the privacy
 * floor, so a thin cohort can't deanonymize a peer.
 *
 * Uses the standard "percent at or below" definition over the full cohort
 * (this org counted once); 100 means top of the cohort, 0 means strictly the
 * lowest. `cohortComposites` is the peers excluding this org.
 */
export function computePeerPercentile(
  orgComposite: number,
  cohortComposites: number[],
  floor: number = PEER_COHORT_FLOOR
): PosturePercentile | null {
  // The cohort the rank is read over includes this org once.
  const cohortSize = cohortComposites.length + 1;
  if (cohortSize < floor) return null;

  const atOrBelow = cohortComposites.filter((c) => c <= orgComposite).length + 1;
  const percentile = Math.round((atOrBelow / cohortSize) * 100);

  return { percentile, cohortSize };
}
