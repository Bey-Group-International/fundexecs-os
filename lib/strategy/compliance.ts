/* ============================================================================
 * lib/strategy/compliance.ts — the standing compliance tier (Phase 4).
 *
 * Pure, deterministic helpers for the Adrian-owned compliance lane defined in
 * memory/STRATEGY_COMPOUNDING_BLUEPRINT.md (decision #4). The DB-side seed +
 * refresh live in supabase/migrations/*_standing_compliance_tier.sql (the
 * ensure_compliance_tier / refresh_compliance_tier RPCs); this module holds the
 * escalation rule those RPCs encode, expressed in TS so it is unit-testable
 * without a database and reusable by the read path. No schema, no I/O.
 *
 * Intentionally import-light (no roster / lucide / UI imports) so it stays
 * runnable under node:test's react-server condition. Owner resolution lives in
 * the read path (lib/queries/compliance.ts) via the roster.
 * ========================================================================= */

/** The specialist that owns the standing compliance tier — Adrian (GC). */
export const COMPLIANCE_OWNER_SLUG = 'legal-admin' as const;

/** Compliance objectives that sit ignored past this many days age into High. */
export const COMPLIANCE_STALE_DAYS = 14;

export type CompliancePriority = 'High' | 'Medium' | 'Low';

/** The fields the aging rule reads off a compliance objective. */
export interface ComplianceAgingInput {
  priority: CompliancePriority;
  /** Whether the objective is still open (not done/archived). */
  open: boolean;
  /** Whether the operator has acknowledged (read) it. */
  read: boolean;
  /** Last time the row was touched (ISO string or epoch ms). */
  updatedAt: string | number | Date;
}

/**
 * The escalation rule: an open, unread compliance objective left untouched past
 * the threshold ages into High priority — ignored compliance IS the risk. This
 * mirrors the `update ... set priority = 'high'` pass in refresh_compliance_tier
 * so the UI and the cron agree on what "stale" means.
 *
 * Returns the priority the objective SHOULD carry given `now`. Idempotent: an
 * already-High or non-eligible objective is returned unchanged.
 */
export function agedPriority(
  input: ComplianceAgingInput,
  now: Date = new Date(),
  staleDays: number = COMPLIANCE_STALE_DAYS
): CompliancePriority {
  if (input.priority === 'High') return 'High';
  if (!input.open || input.read) return input.priority;

  const updated = new Date(input.updatedAt).getTime();
  if (Number.isNaN(updated)) return input.priority;

  const ageMs = now.getTime() - updated;
  const thresholdMs = Math.max(staleDays, 1) * 24 * 60 * 60 * 1000;
  return ageMs >= thresholdMs ? 'High' : input.priority;
}
