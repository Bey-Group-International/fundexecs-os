/* ============================================================================
 * lib/earn/outcomes — the PURE, icon-free vocabulary for the Earn ledger.
 *
 * Every approved Earn action writes one `earn_outcomes` row (see
 * lib/actions/earn-actions.ts). This module is the shared, render-safe
 * description of those rows: the outcome kinds, their labels, and which desk
 * produces each. It is deliberately free of any lucide-react / React import so
 * it stays unit-testable — icons trip `react.createContext` under the
 * `--conditions=react-server` test runner, so they live in the sibling
 * `outcome-icons.ts` (same split as integrations' providers/catalog).
 *
 * Kinds map 1:1 to the `earn_outcomes_kind_valid` check constraint. The first
 * two are wired today (the approve loop's `create_deal` / `run_diligence`); the
 * rest are the task-engine triggers' fan-out targets, catalogued here so the
 * ledger renders them the moment those triggers land.
 * ========================================================================= */

export type OutcomeKind =
  | 'deal_sourced'
  | 'diligence_run'
  | 'lp_letter'
  | 'reactivation'
  | 'meeting_notes'
  | 'closing_opened'
  | 'data_room_grant'
  | 'target_scored';

export interface OutcomeKindMeta {
  /** Short label for the ledger row + filter chip. */
  label: string;
  /**
   * The desk that produces this outcome, by roster slug — the routing
   * attribution that turns the ledger into institutional memory.
   */
  specialistSlug: string;
}

export const OUTCOME_KINDS: Record<OutcomeKind, OutcomeKindMeta> = {
  deal_sourced: { label: 'Deal sourced', specialistSlug: 'deal-sourcer' },
  diligence_run: { label: 'Diligence', specialistSlug: 'earnest-fundmaker' },
  lp_letter: { label: 'LP letter', specialistSlug: 'investor-relations' },
  reactivation: { label: 'Reactivation', specialistSlug: 'capital-raiser' },
  meeting_notes: { label: 'Meeting notes', specialistSlug: 'master-workflow' },
  closing_opened: { label: 'Closing', specialistSlug: 'master-workflow' },
  data_room_grant: { label: 'Data room', specialistSlug: 'investor-relations' },
  target_scored: { label: 'Target scored', specialistSlug: 'deal-sourcer' }
};

/** All kinds, in ledger filter-chip order. */
export const OUTCOME_KIND_ORDER: OutcomeKind[] = [
  'deal_sourced',
  'diligence_run',
  'lp_letter',
  'reactivation',
  'meeting_notes',
  'closing_opened',
  'data_room_grant',
  'target_scored'
];

export function isOutcomeKind(value: string): value is OutcomeKind {
  return value in OUTCOME_KINDS;
}

/** A ledger row as the `/earn` surface renders it. */
export interface EarnOutcome {
  id: string;
  kind: OutcomeKind;
  specialistSlug: string;
  title: string;
  summary: string | null;
  homeSurface: string | null;
  homeHref: string | null;
  /** Whether a Chain-of-Trust audit row backs this outcome (provability). */
  hasTrustProof: boolean;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}
