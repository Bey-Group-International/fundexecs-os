// lib/compounding.ts
// Phase 0 of the tokenization model (see docs/TOKENIZATION_LAYERS.md): the single
// resolver every layer reads. It turns an org's *existing* track record into a
// compounding profile — a price discount, a match boost, and a stake multiplier —
// so participation compounds without any new schema. Reputation here is a
// PROXY derived from data we already store (closed deals, verified records) plus
// subscription tenure; Phase 1 replaces the proxy with a stored reputation
// ledger, but every consumer of this module keeps working unchanged.
//
// The pure math lives here (trivially unit-testable); `compoundingProfile()`
// gathers the signals from Supabase and defers to it.
import { createServerClient } from "@/lib/supabase/server";
import { loyaltyBonus, LOYALTY_CAP } from "@/lib/billing";

export type ReputationTier = "unranked" | "verified" | "established" | "principal";

// Raw, first-party signals that feed the score. All are things the platform can
// already observe — never self-asserted.
export interface CompoundingSignals {
  /** Deals that reached a closed state (stage 'owned' or 'exited'). */
  closedDeals: number;
  /** Records an operator has verified (proxy for diligence rigor + data contribution). */
  verifiedRecords: number;
  /** Whole months of continuous subscription tenure. */
  tenureMonths: number;
}

export interface CompoundingProfile {
  tier: ReputationTier;
  /** 0..∞ merit points (closed deals dominate). */
  score: number;
  /** Multiplier applied to the credit cost of an action (≤ 1 = a discount). */
  priceMultiplier: number;
  /** The discount as a whole percentage, for display ("−15%"). */
  discountPct: number;
  /** Additive points a reputable org's listings gain in match ranking. */
  matchBoost: number;
  /** Multiplier on a required stake (< 1 = reputable orgs post less). */
  requiredStakeMultiplier: number;
  /** Per-factor discount breakdown so the UI can show line items. */
  factors: { meritPct: number; loyaltyPct: number };
}

// --- Scoring constants -------------------------------------------------------
// A closed deal is the strongest earnable signal; verified records accrue slowly
// and are capped so they can't substitute for actually closing things.
const CLOSE_POINTS = 25;
const VERIFIED_POINTS = 3;
const VERIFIED_SCORE_CAP = 60; // verified records contribute at most this much

// Tier thresholds (in merit points).
const TIER_MIN: Record<ReputationTier, number> = {
  unranked: 0,
  verified: 40, // ~ two closed deals, or one close + verification rigor
  established: 120,
  principal: 300,
};

// --- Guardrails --------------------------------------------------------------
// Merit must dominate purchasable/passive inputs. The merit discount can reach
// 20%; loyalty tops out at 5% — so longevity compounds but never out-weighs a
// real track record. This is the line between a trust graph and a points casino.
const MERIT_DISCOUNT_BY_TIER: Record<ReputationTier, number> = {
  unranked: 0,
  verified: 0.1,
  established: 0.15,
  principal: 0.2,
};
const LOYALTY_DISCOUNT_CAP = 0.05;
const PRICE_FLOOR = 0.75; // never discount an action more than 25% all-in

const MATCH_BOOST_BY_TIER: Record<ReputationTier, number> = {
  unranked: 0,
  verified: 6,
  established: 12,
  principal: 18,
};

const STAKE_MULTIPLIER_BY_TIER: Record<ReputationTier, number> = {
  unranked: 1,
  verified: 0.85,
  established: 0.65,
  principal: 0.5,
};

/** Merit points from raw signals. Pure. */
export function reputationScore(signals: CompoundingSignals): number {
  const closes = Math.max(0, signals.closedDeals) * CLOSE_POINTS;
  const verified = Math.min(VERIFIED_SCORE_CAP, Math.max(0, signals.verifiedRecords) * VERIFIED_POINTS);
  return closes + verified;
}

/** The tier a merit score falls into. Pure. */
export function tierForScore(score: number): ReputationTier {
  if (score >= TIER_MIN.principal) return "principal";
  if (score >= TIER_MIN.established) return "established";
  if (score >= TIER_MIN.verified) return "verified";
  return "unranked";
}

/**
 * Build the full profile from a known merit score + tenure. Pure. Used both by
 * the Phase 0 proxy (score derived from signals) and Phase 1 (score read from the
 * stored reputation ledger), so the two share one set of guardrails.
 */
export function profileFromScore(score: number, tenureMonths: number): CompoundingProfile {
  const tier = tierForScore(score);

  const meritDiscount = MERIT_DISCOUNT_BY_TIER[tier];
  // Loyalty discount tracks the existing tenure-credit curve, normalized to its
  // cap and scaled into the loyalty discount band, so the two surfaces agree.
  const loyaltyDiscount = LOYALTY_DISCOUNT_CAP * (loyaltyBonus(tenureMonths) / LOYALTY_CAP);

  const rawMultiplier = 1 - meritDiscount - loyaltyDiscount;
  const priceMultiplier = Math.max(PRICE_FLOOR, Number(rawMultiplier.toFixed(4)));

  return {
    tier,
    score,
    priceMultiplier,
    discountPct: Math.round((1 - priceMultiplier) * 100),
    matchBoost: MATCH_BOOST_BY_TIER[tier],
    requiredStakeMultiplier: STAKE_MULTIPLIER_BY_TIER[tier],
    factors: {
      meritPct: Math.round(meritDiscount * 100),
      loyaltyPct: Math.round(loyaltyDiscount * 100),
    },
  };
}

/** Build the full profile from raw signals (the Phase 0 proxy path). Pure. */
export function profileFromSignals(signals: CompoundingSignals): CompoundingProfile {
  return profileFromScore(reputationScore(signals), signals.tenureMonths);
}

/**
 * The credit cost of an action after an org's compounding discount, rounded to a
 * whole credit (never below 1 for a positive base). This is what `grantCredits`
 * should debit so the discount is real, not cosmetic.
 */
export function effectiveCost(baseCost: number, profile: CompoundingProfile): number {
  if (baseCost <= 0) return 0;
  return Math.max(1, Math.round(baseCost * profile.priceMultiplier));
}

const UNRANKED: CompoundingProfile = profileFromSignals({
  closedDeals: 0,
  verifiedRecords: 0,
  tenureMonths: 0,
});

/**
 * Resolve an org's live compounding profile. Standing comes from the stored
 * reputation ledger (Phase 1) when the org has earned any; otherwise it falls
 * back to the Phase 0 PROXY derived from existing tables (closed deals + verified
 * records), so orgs that earned a track record before minting existed still rank.
 * Tenure (loyalty) always comes from the wallet. Returns the unranked profile for
 * an org with no footprint, so callers can use it unconditionally.
 */
export async function compoundingProfile(orgId: string): Promise<CompoundingProfile> {
  const supabase = createServerClient();

  const [stored, wallet] = await Promise.all([
    supabase.from("reputation_scores").select("score").eq("organization_id", orgId).maybeSingle(),
    supabase.from("wallets").select("plan_started_at, plan").eq("organization_id", orgId).maybeSingle(),
  ]);

  // Tenure accrues from the original plan-start date, not the last credit top-up.
  const since = wallet.data?.plan ? wallet.data?.plan_started_at : null;
  const tenure = monthsSince(since);

  // Authoritative stored score wins; else compute the proxy.
  if (stored.data) {
    return profileFromScore(stored.data.score, tenure);
  }

  const [closed, verified] = await Promise.all([
    supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .in("stage", ["owned", "exited"]),
    supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("verification_status", "verified"),
  ]);

  return profileFromSignals({
    closedDeals: closed.count ?? 0,
    verifiedRecords: verified.count ?? 0,
    tenureMonths: tenure,
  });
}

export const UNRANKED_PROFILE = UNRANKED;

/** Whole months between an ISO timestamp and now (0 if missing/future). */
function monthsSince(since: string | null | undefined): number {
  if (!since) return 0;
  const start = new Date(since).getTime();
  if (!Number.isFinite(start)) return 0;
  const months = (Date.now() - start) / (1000 * 60 * 60 * 24 * 30.44);
  return Math.max(0, Math.floor(months));
}
