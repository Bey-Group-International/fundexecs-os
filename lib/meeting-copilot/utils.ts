/**
 * lib/meeting-copilot/utils.ts — pure, dependency-free scoring utilities.
 *
 * Kept separate from config.ts (which carries server-only imports) so these
 * functions are testable with `node:test` without pulling in Lucide icons or
 * the team roster. Importable from both client and server contexts.
 */

/** The three analytical agents (`meeting_findings.agent` allowed values). */
export const ANALYST_AGENTS = ['objection_analyst', 'sentiment_scorer', 'action_mapper'] as const;

export type AnalystAgent = (typeof ANALYST_AGENTS)[number];

/** The synthesis agent — the final, paid judgment. */
export const SYNTHESIS_AGENT = 'synthesis' as const;

/**
 * Derive a panel tone from a commitment-probability score.
 * < 30  → danger (cold meeting, real risk)
 * 30–69 → azure  (neutral/warm, keep moving)
 * ≥ 70  → success (strong signal, press for close)
 */
export function commitmentTone(score: number): 'danger' | 'azure' | 'success' {
  if (score < 30) return 'danger';
  if (score < 70) return 'azure';
  return 'success';
}

/**
 * Clamp a raw score to the 0–100 integer range. Returns null for non-finite
 * or null/undefined input (e.g. NaN, Infinity, non-numeric strings, null).
 * Note: `Number(null)` is 0 in JS — this guard ensures null is treated as
 * "no score" rather than "score of 0".
 */
export function clampCommitment(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}
