/**
 * lib/capital-calls/vocabulary.ts — the Capital calls room's pure vocabulary.
 *
 * A call (or distribution) is issued against the committed LP roster; each
 * LP line then resolves notified → funded (calls) / paid (distributions).
 * The call itself settles when every line resolves — derived, never stored
 * ahead of the facts. Overdue is likewise derived: a line past the call's
 * due date that hasn't resolved. Pure so the server actions and the UI agree.
 */

export type CallKind = 'call' | 'distribution';

export const CALL_KINDS: readonly CallKind[] = ['call', 'distribution'];

export function isCallKind(k: string): k is CallKind {
  return (CALL_KINDS as readonly string[]).includes(k);
}

export const CALL_KIND_LABEL: Record<CallKind, string> = {
  call: 'Capital call',
  distribution: 'Distribution'
};

/** What a resolved LP line is called, per kind. */
export const CALL_RESOLVED_STATUS: Record<CallKind, string> = {
  call: 'funded',
  distribution: 'paid'
};

export type CallStatus = 'issued' | 'settled';

export interface CallLpLike {
  status: string;
}

export function isLpResolved(kind: CallKind, status: string): boolean {
  return status === CALL_RESOLVED_STATUS[kind];
}

export interface CallProgress {
  resolved: number;
  total: number;
  pct: number;
  complete: boolean;
}

export function callProgress(kind: CallKind, lps: readonly CallLpLike[]): CallProgress {
  const total = lps.length;
  const resolved = lps.filter((l) => isLpResolved(kind, l.status)).length;
  return {
    resolved,
    total,
    pct: total > 0 ? Math.round((resolved / total) * 100) : 0,
    complete: total > 0 && resolved === total
  };
}

/** Per-LP share of the call total, evenly split — the no-weights fallback. */
export function lpShare(total: number | null, lpCount: number): number | null {
  if (total == null || !Number.isFinite(total) || total <= 0 || lpCount <= 0) return null;
  return Math.round(total / lpCount);
}

/**
 * Per-LP shares of the call total, pro-rata to each LP's real commitment.
 * With any positive weights, each share is total × weight / weightSum — a
 * missing or zero weight yields 0, the honest reading of "no commitment
 * amount on record". With no positive weights at all, every LP gets the
 * even split. Shares always sum back to the total (largest-remainder
 * rounding, earliest index wins ties) — an issued call never gains or
 * loses dollars to rounding.
 */
export function proRataShares(
  total: number | null,
  weights: ReadonlyArray<number | null>
): Array<number | null> {
  if (total == null || !Number.isFinite(total) || total <= 0 || weights.length === 0) {
    return weights.map(() => null);
  }
  const clean = weights.map((w) => (w != null && Number.isFinite(w) && w > 0 ? w : 0));
  const weightSum = clean.reduce((s, w) => s + w, 0);
  const effective = weightSum > 0 ? clean : weights.map(() => 1);
  const effectiveSum = weightSum > 0 ? weightSum : weights.length;

  const raw = effective.map((w) => (total * w) / effectiveSum);
  const shares = raw.map(Math.floor);
  let remainder = Math.round(total - shares.reduce((s, v) => s + v, 0));
  const byFraction = raw
    .map((r, i) => ({ frac: r - Math.floor(r), i }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of byFraction) {
    if (remainder <= 0) break;
    shares[i] += 1;
    remainder -= 1;
  }
  return shares;
}

/* ---- Overdue: derived from the call's due date, never stored ---- */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A call is overdue once its due day has fully passed. */
export function isCallOverdue(dueAt: string | null, now: Date): boolean {
  if (!dueAt) return false;
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) return false;
  return now.getTime() >= due + DAY_MS;
}

export type LpLineState = 'resolved' | 'pending' | 'overdue';

/** An unresolved line on an overdue, unsettled call is overdue. */
export function lpLineState(
  kind: CallKind,
  lineStatus: string,
  callStatus: string,
  dueAt: string | null,
  now: Date
): LpLineState {
  if (isLpResolved(kind, lineStatus)) return 'resolved';
  if (callStatus !== 'settled' && isCallOverdue(dueAt, now)) return 'overdue';
  return 'pending';
}

export const LP_STATE_TONE: Record<LpLineState, 'success' | 'gold' | 'danger'> = {
  resolved: 'success',
  pending: 'gold',
  overdue: 'danger'
};

export const LP_STATE_LABEL: Record<CallKind, Record<LpLineState, string>> = {
  call: { resolved: 'Funded', pending: 'Pending', overdue: 'Overdue' },
  distribution: { resolved: 'Paid', pending: 'Pending', overdue: 'Overdue' }
};

/** The posture card's left-border state: settled > overdue > open. */
export type CallPosture = 'settled' | 'overdue' | 'open';

export function callPosture(callStatus: string, overdueCount: number): CallPosture {
  if (callStatus === 'settled') return 'settled';
  if (overdueCount > 0) return 'overdue';
  return 'open';
}

/* ---- Fund capital summary: committed / called / dry powder ---- */

export interface CapitalSummary {
  committed: number;
  called: number;
  dryPowder: number;
}

export interface CallTotalLike {
  kind: string;
  total: number | null;
}

export function capitalSummary(
  committedTotal: number,
  calls: readonly CallTotalLike[]
): CapitalSummary {
  const committed = Number.isFinite(committedTotal) && committedTotal > 0 ? committedTotal : 0;
  const called = calls
    .filter((c) => c.kind === 'call')
    .reduce((s, c) => s + (c.total != null && Number.isFinite(c.total) ? c.total : 0), 0);
  return { committed, called, dryPowder: Math.max(0, committed - called) };
}

/* ---- Distributions: one status vocabulary over both real sources ---- */

export type DistStatusKey = 'paid' | 'staged' | 'planned' | 'cancelled';

export const DIST_STATUS: Record<
  DistStatusKey,
  { tone: 'success' | 'gold' | 'neutral'; label: string }
> = {
  paid: { tone: 'success', label: 'Paid' },
  staged: { tone: 'gold', label: 'Staged' },
  planned: { tone: 'neutral', label: 'Planned' },
  cancelled: { tone: 'neutral', label: 'Cancelled' }
};

/**
 * LP Room `distributions` rows: paid/cancelled map directly; a pending row
 * is planned while its distribution date is still ahead, staged once due.
 */
export function ledgerDistStatus(
  status: string,
  distributionDate: string | null,
  now: Date
): DistStatusKey {
  if (status === 'paid') return 'paid';
  if (status === 'cancelled') return 'cancelled';
  if (distributionDate) {
    const due = Date.parse(distributionDate);
    if (!Number.isNaN(due) && due > now.getTime()) return 'planned';
  }
  return 'staged';
}

/** Call-sourced distributions: settled means every LP was paid. */
export function callDistStatus(callStatus: string): DistStatusKey {
  return callStatus === 'settled' ? 'paid' : 'staged';
}
