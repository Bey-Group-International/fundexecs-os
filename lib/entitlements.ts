// lib/entitlements.ts
// Phase 0 of the tokenization model (see docs/TOKENIZATION_LAYERS.md): the Access
// layer's capability resolver. Rather than hand-maintaining boolean flag columns,
// entitlements are DERIVED from an org's plan and its reputation tier, so they
// stay consistent as the Governance and Security layers come online. Today the
// inputs are plan + tier; Phase 3 adds active stake without changing callers.
import { PLAN_BY_KEY, type PlanKey } from "@/lib/billing";
import {
  compoundingProfile,
  type ReputationTier,
  type CompoundingProfile,
} from "@/lib/compounding";

export interface Entitlements {
  /** May create a marketplace listing (Governance layer gates `draft → listed`). */
  canList: boolean;
  /** May issue a verification/attestation that earns counterparties reputation. */
  canAttest: boolean;
  /** May vouch for another org (a reputation transfer — principal-tier only). */
  canVouch: boolean;
  /** Listings/runs jump the priority queue. */
  priorityQueue: boolean;
}

// Tier rank for threshold comparisons.
const TIER_RANK: Record<ReputationTier, number> = {
  unranked: 0,
  verified: 1,
  established: 2,
  principal: 3,
};

function atLeast(tier: ReputationTier, min: ReputationTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[min];
}

/**
 * Derive capabilities from plan + reputation tier. Pure, so it can be unit-tested
 * and reused anywhere a profile is already in hand. A paid plan is a baseline for
 * listing; reputation is what unlocks the trusted actions (attesting, vouching).
 */
export function entitlementsFor(
  planKey: string | null | undefined,
  profile: CompoundingProfile,
): Entitlements {
  const hasPlan = !!planKey && !!PLAN_BY_KEY[planKey as PlanKey];
  const tier = profile.tier;

  return {
    // Any plan-holder may list; a verified track record also clears the gate so
    // proven operators aren't blocked by billing state.
    canList: hasPlan || atLeast(tier, "verified"),
    // Attesting is a trust action — earned, not bought.
    canAttest: atLeast(tier, "established"),
    canVouch: atLeast(tier, "principal"),
    priorityQueue: atLeast(tier, "established"),
  };
}

/** Resolve an org's live entitlements (plan + computed reputation). */
export async function entitlements(
  orgId: string,
  planKey: string | null | undefined,
): Promise<Entitlements> {
  const profile = await compoundingProfile(orgId);
  return entitlementsFor(planKey, profile);
}
