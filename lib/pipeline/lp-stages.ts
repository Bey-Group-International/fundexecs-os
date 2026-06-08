/* ============================================================================
 * lib/pipeline/lp-stages.ts — client-safe LP pipeline stage constants + view
 * types, shared by the server loader (lib/queries/lp-pipeline), the server
 * actions, and the client board. Kept free of `server-only` so the client
 * board can import the stage list as a value.
 * ========================================================================= */

export const LP_STAGES = [
  { key: 'prospect', label: 'Prospect' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'soft_circled', label: 'Soft-circle' },
  { key: 'committed', label: 'Committed' }
] as const;

export type LpStageKey = (typeof LP_STAGES)[number]['key'];

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
  /** 0–100 progress score derived from the stage. */
  fit: number;
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
