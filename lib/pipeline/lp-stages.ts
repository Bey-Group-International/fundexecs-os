/* ============================================================================
 * lib/pipeline/lp-stages.ts — client-safe LP pipeline stage constants + view
 * types, shared by the server loader (lib/queries/lp-pipeline), the server
 * actions, and the client board. Kept free of `server-only` so the client
 * board can import the stage list as a value.
 * ========================================================================= */

export const LP_STAGES = [
  { key: 'prospect', label: 'Target' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'soft_circled', label: 'Soft-circled' },
  { key: 'committed', label: 'Committed' }
] as const;

export type LpStageKey = (typeof LP_STAGES)[number]['key'];

/** Map a free-form capital_providers.status to a canonical board stage. */
export function normalizeLpStage(status: string | null | undefined): LpStageKey | 'passed' {
  const s = (status ?? '').toLowerCase();
  if (/(commit|won|closed|funded)/.test(s)) return 'committed';
  if (/(soft|circle)/.test(s)) return 'soft_circled';
  if (/(contact|engage|intro|active|warm|meeting)/.test(s)) return 'contacted';
  if (/(pass|dead|lost|declin|cold)/.test(s)) return 'passed';
  return 'prospect';
}

/** The next stage along the canonical order, or null when terminal. */
export function nextLpStage(stage: LpStageKey): LpStageKey | null {
  const i = LP_STAGES.findIndex((s) => s.key === stage);
  return i >= 0 && i < LP_STAGES.length - 1 ? LP_STAGES[i + 1].key : null;
}

/** A single representative commitment value for an LP (range midpoint). */
export function lpValue(min: number | null, max: number | null): number {
  if (min != null && max != null) return Math.round((min + max) / 2);
  return max ?? min ?? 0;
}

/** All assignable stage keys (board stages + the terminal "passed"). */
export const LP_STAGE_KEYS = [
  'prospect',
  'contacted',
  'soft_circled',
  'committed',
  'passed'
] as const;

export interface LpEntry {
  id: string;
  name: string;
  stage: LpStageKey;
  capitalTypes: string[];
  checkSizeMin: number | null;
  checkSizeMax: number | null;
  description: string | null;
  fitRationale: string | null;
  assignedSpecialist: string | null;
  firstTouchNote: string | null;
  /** Sloane's 0–100 fit score when one has been recorded; never synthesized. */
  fit: number | null;
  /** Warm/Hot/Cold relationship temperature, when recorded. */
  warmth: string | null;
  /** Where the LP came from ("Sloane sourced", "Warm intro · …"), when recorded. */
  source: string | null;
  /** Human-readable last-touch note ("2d ago", a date), when recorded. */
  lastTouch: string | null;
  createdAt: string;
}

export interface LpStageColumn {
  key: LpStageKey;
  label: string;
  lps: LpEntry[];
}

export interface LpPipelineData {
  columns: LpStageColumn[];
  totalLps: number;
  committedValue: number;
  softCircledValue: number;
  passedCount: number;
  empty: boolean;
}
