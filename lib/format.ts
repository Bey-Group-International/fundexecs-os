/**
 * lib/format.ts — tiny shared formatting helpers.
 */

/**
 * Compact dollar formatting for dense surfaces (rail badges, KPI chips):
 * $4.2M, $850K, $1.2B, $0. Rounds to a single significant decimal for M/B.
 */
export function compactMoney(n: number): string {
  const v = Number.isFinite(n) ? Math.round(n) : 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${abs}`;
}
