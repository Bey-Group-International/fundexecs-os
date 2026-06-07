import type { BadgeTone } from '@/components/ui';

/**
 * Render-agnostic display helpers for the Deal Desk surface. Kept dependency-free
 * so the server page can import them without pulling in client code.
 */

/** Compact USD formatting (e.g. $1.2M, $850K) for dense KPI/card display. */
export function formatCompactUsd(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) {
    const roundedK = Math.round(amount / 1_000);
    if (Math.abs(roundedK) >= 1_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
    return `$${roundedK}K`;
  }
  return `$${Math.round(amount)}`;
}

/** Tone for a 0–100 thesis-fit score. */
export function fitTone(value: number): BadgeTone {
  if (value >= 70) return 'success';
  if (value >= 45) return 'gold';
  return 'neutral';
}

/** Accent color (token) for a stage, by its order position. Later stages run
 *  warmer toward the gold "committed" end of the funnel. */
export function stageColor(index: number, total: number): string {
  const t = total > 1 ? index / (total - 1) : 0;
  if (t >= 0.75) return 'var(--gold-1)';
  if (t >= 0.4) return 'var(--azure-1)';
  return 'var(--fg-4)';
}
