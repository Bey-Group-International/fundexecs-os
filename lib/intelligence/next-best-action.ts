/* ============================================================================
 * lib/intelligence/next-best-action.ts — the FundExecs Next-Best-Action engine.
 *
 * A proprietary, key-free meta-signal: it fuses the desk's own intelligence —
 * pending Action-Queue approvals, low-conviction deals + their lever, cold
 * relationships, and stalled deals — into ONE ranked "do this next" worklist.
 * No external APIs, no model: every candidate is derived from systems already
 * in the OS, and ordering is deterministic.
 *
 * Pure + total — trivially unit-testable. The query layer maps each source into
 * `NextAction` candidates via the priority helpers here, then `rankNextActions`
 * orders + caps them.
 * ========================================================================= */

export type ActionKind = 'approval' | 'velocity' | 'reconnect' | 'conviction';

export interface NextAction {
  id: string;
  kind: ActionKind;
  /** Headline ("Approve: scout targets", "Reconnect: Jane Doe", …). */
  title: string;
  /** One-line evidence / the lever. */
  detail: string;
  /** 0–100 urgency used for ordering. */
  priority: number;
  /** Where acting on it lives. */
  href: string;
}

/** Tiebreak order when priorities are equal — operator decisions first. */
const KIND_RANK: Record<ActionKind, number> = {
  approval: 3,
  velocity: 2,
  reconnect: 1,
  conviction: 0
};

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Pending approvals are the operator's call — always near the top. */
export function approvalPriority(): number {
  return 90;
}

/** A stalled deal: stuck outranks slowing. */
export function velocityPriority(band: 'Stuck' | 'Slowing'): number {
  return band === 'Stuck' ? 78 : 52;
}

/** Reconnect items already carry a 0–100 priority; scale into the worklist. */
export function reconnectPriority(itemPriority: number): number {
  return clamp(itemPriority * 0.8);
}

/** A low-conviction deal needs work — the lower the score, the higher the nudge. */
export function convictionPriority(score: number): number {
  return clamp((100 - clamp(score)) * 0.6);
}

/**
 * Order candidates by priority (desc), then by kind rank, then by title for a
 * stable result; cap to `limit`. Pure.
 */
export function rankNextActions(candidates: NextAction[], limit = 8): NextAction[] {
  return [...candidates]
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        KIND_RANK[b.kind] - KIND_RANK[a.kind] ||
        a.title.localeCompare(b.title)
    )
    .slice(0, limit);
}
