/* ============================================================================
 * lib/pipeline/lp-meta.ts — pure parser over `capital_providers.criteria`.
 *
 * The criteria jsonb carries the AI-enriched metadata an LP arrives with
 * (adoptLp writes description/fitRationale/specialist/source; future scoring
 * writes fitScore/warmth/lastTouch). Everything is optional and free-form, so
 * the Capital Map only renders what is genuinely present — a missing fit
 * score stays null rather than being synthesized from the stage.
 * ========================================================================= */

export interface LpMeta {
  description: string | null;
  fitRationale: string | null;
  assignedSpecialist: string | null;
  firstTouchNote: string | null;
  /** 0–100 fit score, clamped; null when no score has been recorded. */
  fit: number | null;
  warmth: string | null;
  source: string | null;
  lastTouch: string | null;
}

/** Machine source tokens → the vocabulary the operator reads. */
const SOURCE_LABELS: Record<string, string> = {
  ai_lp_discovery: 'Sloane sourced'
};

function str(meta: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = meta[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function num(meta: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const v = meta[key];
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function parseLpMeta(criteria: unknown): LpMeta {
  const meta =
    criteria && typeof criteria === 'object' && !Array.isArray(criteria)
      ? (criteria as Record<string, unknown>)
      : {};

  const fit = num(meta, 'fitScore', 'fit_score', 'fit');
  const warmth = str(meta, 'warmth');
  const source = str(meta, 'source');

  return {
    description: str(meta, 'description'),
    fitRationale: str(meta, 'fitRationale', 'fit_rationale'),
    assignedSpecialist: str(meta, 'assignedSpecialist', 'assigned_specialist'),
    firstTouchNote: str(meta, 'firstTouchNote', 'first_touch_note'),
    fit: fit == null ? null : Math.min(100, Math.max(0, Math.round(fit))),
    warmth: warmth ? warmth[0].toUpperCase() + warmth.slice(1).toLowerCase() : null,
    source: source ? (SOURCE_LABELS[source] ?? source) : null,
    lastTouch: str(meta, 'lastTouch', 'last_touch')
  };
}
