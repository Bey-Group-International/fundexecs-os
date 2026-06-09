import type { MemberType } from '@/lib/member-types';
import type { ProfileTierId } from './tiers';

/* ============================================================================
 * lib/proof-of-truth/payoffs.ts — the compounding payoff for each rung.
 *
 * A readiness rung is only motivating if completing it visibly multiplies the
 * member's value. This maps each completed rung to the consequence it unlocks —
 * "Matchable to N", "Diligence-ready" — so the ladder reads as a climb that
 * compounds, not a form being filled. Only the mandate line carries a live
 * match count; the rest are the qualitative state the rung earns.
 *
 * Pure (no React, no server-only): the server Profile surface passes the live
 * count, the client wizard passes none, and both render the identical lines.
 * ========================================================================= */

/** Who a member becomes matchable to once their mandate reads strong. */
const MATCH_NOUN: Record<MemberType, string> = {
  investment_firm: 'LP & co-investor mandates',
  individual_investor: 'deals & syndicates',
  startup: 'investors',
  service_provider: 'clients',
  student: 'mentors & firms'
};

export interface PayoffInput {
  memberType: MemberType;
  /** Live count of matches waiting for the org, when known. Fail-open: null. */
  matchCount?: number | null;
}

/**
 * The payoff line for each completed rung. The mandate line shows the live match
 * count when there is one (the embedding refresh on save keeps matching warm),
 * and degrades to a qualitative "Matchable to <counterparty>" otherwise.
 */
export function buildPayoffs({
  memberType,
  matchCount
}: PayoffInput): Partial<Record<ProfileTierId, string>> {
  const matchable =
    typeof matchCount === 'number' && matchCount > 0
      ? `Matchable — ${matchCount} ${matchCount === 1 ? 'match' : 'matches'} waiting`
      : `Matchable to ${MATCH_NOUN[memberType]}`;

  return {
    identity: 'Discoverable on the network',
    mandate: matchable,
    evidence: 'Diligence-ready — the proof holds up'
  };
}
