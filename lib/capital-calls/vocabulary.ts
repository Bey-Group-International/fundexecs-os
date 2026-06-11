/**
 * lib/capital-calls/vocabulary.ts — the Capital calls room's pure vocabulary.
 *
 * A call (or distribution) is issued against the committed LP roster; each
 * LP line then resolves notified → funded (calls) / paid (distributions).
 * The call itself settles when every line resolves — derived, never stored
 * ahead of the facts. Pure so the server actions and the UI agree.
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

/** Per-LP share of the call total, evenly split until commitments carry weights. */
export function lpShare(total: number | null, lpCount: number): number | null {
  if (total == null || !Number.isFinite(total) || total <= 0 || lpCount <= 0) return null;
  return Math.round(total / lpCount);
}
