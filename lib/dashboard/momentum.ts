/* ============================================================================
 * lib/dashboard/momentum.ts — the Resume Hero's momentum deltas (pure, no I/O).
 *
 * The compounding dashboard (memory/DASHBOARD_V2_COMPOUNDING.md) shows progress
 * as a *delta*, not just a value: "Readiness 72 (+5 this week) · Execution (+Δ)
 * · Raise (+Δ)". This module owns the pure shape + the one rule that turns a
 * live value and a prior daily snapshot into that delta. Kept React- and
 * I/O-free (mirroring lib/strategy/posture-trend.ts) so the loader composes it
 * and unit tests read one spelling.
 *
 * Guardrail (carried from the compounding blueprint): NEVER fabricate a Δ. When
 * there is no prior snapshot to diff against, `delta` is null and the direction
 * is 'flat' — the UI shows the value with no movement claim until history exists.
 * ========================================================================= */

/** One resume-hero metric: the live value plus its week-over-week change. */
export interface MomentumDelta {
  /** Current value, 0–100 (rounded). */
  value: number;
  /**
   * Change in points vs. the prior daily snapshot, or null when no prior
   * snapshot exists yet (the seam degrades to "no-Δ" rather than faking 0).
   */
  delta: number | null;
  /** Direction of travel — 'flat' whenever `delta` is null or 0. */
  direction: 'up' | 'down' | 'flat';
}

/**
 * The three deltas the resume hero surfaces — readiness, execution, and raise —
 * each "value (+Δ)". Sourced from the daily snapshot trails
 * (`readiness_snapshots` + `org_posture_snapshots`) by the loader.
 */
export interface MomentumDeltas {
  readiness: MomentumDelta;
  execution: MomentumDelta;
  raise: MomentumDelta;
}

/**
 * Build a single momentum delta from a live `current` value and an optional
 * `prior` snapshot value. Pure and total: rounds both ends, returns a null
 * delta (flat) when there's no prior to compare against, and never invents
 * movement. Non-finite inputs are treated as "no prior".
 */
export function momentumDelta(current: number, prior: number | null | undefined): MomentumDelta {
  const value = Number.isFinite(current) ? Math.round(current) : 0;
  if (prior === null || prior === undefined || !Number.isFinite(prior)) {
    return { value, delta: null, direction: 'flat' };
  }
  const delta = value - Math.round(prior);
  return { value, delta, direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' };
}
