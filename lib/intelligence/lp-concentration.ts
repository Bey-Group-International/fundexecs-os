/* ============================================================================
 * lib/intelligence/lp-concentration.ts — LP Concentration & Commitment Health.
 *
 * A proprietary, key-free fund-risk read on the LP base: how concentrated the
 * committed capital is across limited partners, and whether one anchor dominates
 * the fund. The capital-raise-side counterpart to deal concentration — same
 * Herfindahl discipline, applied to who funds the fund. No external APIs, no
 * model: derived from the commitments the OS already holds.
 *
 * "Who funds the fund, and how much rides on one of them?" answered
 * deterministically. Pure + total — trivially unit-testable.
 * ========================================================================= */

/** A committed amount attributable to one LP — a structural subset of the row. */
export interface LpCommitment {
  lpId: string;
  lpName: string;
  /** Committed amount; null/0 is ignored. */
  amount: number | null;
}

export type LpConcentrationBand = 'Diversified' | 'Balanced' | 'Concentrated' | 'Single-anchor';

export interface LpShare {
  lpId: string;
  lpName: string;
  amount: number;
  /** Share of total committed (0–100, rounded). */
  share: number;
}

export interface LpConcentration {
  totalCommitted: number;
  /** Number of distinct LPs with committed capital. */
  lpCount: number;
  /** LPs by commitment, largest first (capped). */
  ranked: LpShare[];
  /** The single largest LP (null when none). */
  topLp: LpShare | null;
  /** Combined share of the top 3 LPs (0–100, rounded). */
  top3Share: number;
  /** Herfindahl–Hirschman Index over LP shares, 0–10000. */
  hhi: number;
  band: LpConcentrationBand;
  headline: string;
}

const MAX_RANKED = 8;

function amountOf(c: LpCommitment): number {
  return Number.isFinite(c.amount) && (c.amount as number) > 0 ? (c.amount as number) : 0;
}

function pct(part: number, whole: number): number {
  if (!(whole > 0)) return 0;
  return Math.round(Math.max(0, Math.min(100, (part / whole) * 100)));
}

/** Single-name share drives the band; HHI escalates a borderline base. */
function bandFor(topShare: number, hhi: number): LpConcentrationBand {
  if (topShare >= 50 || hhi >= 4000) return 'Single-anchor';
  if (topShare >= 30 || hhi >= 2500) return 'Concentrated';
  if (topShare >= 18 || hhi >= 1500) return 'Balanced';
  return 'Diversified';
}

/**
 * Aggregate commitments by LP and compute the concentration of the committed
 * base. Multiple rows per LP are summed. Pure.
 */
export function computeLpConcentration(commitments: LpCommitment[]): LpConcentration {
  // Aggregate by LP.
  const byLp = new Map<string, { name: string; amount: number }>();
  for (const c of commitments) {
    const amt = amountOf(c);
    if (amt <= 0) continue;
    const cur = byLp.get(c.lpId) ?? { name: c.lpName, amount: 0 };
    cur.amount += amt;
    // Prefer a non-empty name if one row has it.
    if (!cur.name && c.lpName) cur.name = c.lpName;
    byLp.set(c.lpId, cur);
  }

  const totalCommitted = [...byLp.values()].reduce((s, v) => s + v.amount, 0);

  const ranked: LpShare[] = [...byLp.entries()]
    .map(([lpId, v]) => ({
      lpId,
      lpName: v.name || 'LP on record',
      amount: v.amount,
      share: pct(v.amount, totalCommitted)
    }))
    .sort((a, b) => b.amount - a.amount || a.lpName.localeCompare(b.lpName));

  const topLp = ranked[0] ?? null;
  const top3Share = pct(
    ranked.slice(0, 3).reduce((s, l) => s + l.amount, 0),
    totalCommitted
  );

  const hhi =
    totalCommitted > 0
      ? Math.round(
          ranked.reduce((s, l) => {
            const frac = l.amount / totalCommitted;
            return s + frac * frac;
          }, 0) * 10000
        )
      : 0;

  const band = bandFor(topLp?.share ?? 0, hhi);
  const lpCount = ranked.length;

  const headline =
    lpCount === 0
      ? 'No committed LPs yet'
      : band === 'Diversified'
        ? `Well diversified across ${lpCount} LP${lpCount === 1 ? '' : 's'}`
        : `${topLp ? topLp.lpName : 'Top LP'} anchors ${topLp?.share ?? 0}% of committed capital`;

  return {
    totalCommitted,
    lpCount,
    ranked: ranked.slice(0, MAX_RANKED),
    topLp,
    top3Share,
    hhi,
    band,
    headline
  };
}
