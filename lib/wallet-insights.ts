// lib/wallet-insights.ts
// Pure wallet analytics (no DB, no I/O) so they unit-test with plain numbers and
// can be reused by any surface. Turns the two facts the Wallet page already has —
// current balance and 30-day credit burn — into a runway estimate, a tiered
// balance-health signal, and grounded plan / top-up recommendations. Keeping the
// math here means the page stays presentational and the thresholds are testable.
import { PLANS, PLAN_BY_KEY, CREDIT_PACKS, type PlanKey, type CreditPack } from "@/lib/billing";

// Mirrors CREDIT_GRACE_BUFFER (lib/credits) as a pure default so this module
// pulls in no server-only imports; the Wallet page passes the real buffer.
export const LOW_BALANCE_FLOOR = 100;

// Runway tiers. "critical" → act now (blocked soon); "low" → top up this week;
// "healthy" → comfortable.
export type BalanceHealth = "critical" | "low" | "healthy";

export interface WalletRunway {
  /** Average credits consumed per day over the sampled window (≥ 0). */
  dailyBurn: number;
  /** Days of runway at the current burn, or null when there's no measurable burn. */
  runwayDays: number | null;
  health: BalanceHealth;
}

// Days-of-runway model from balance + trailing spend. `windowDays` is the period
// `spend` was summed over (default 30, matching recentSpend). No burn → infinite
// runway (null) so a healthy idle org isn't nagged.
export function walletRunway(
  balance: number,
  spend: number,
  windowDays = 30,
  floor = LOW_BALANCE_FLOOR,
): WalletRunway {
  const safeBalance = Math.max(0, balance);
  const dailyBurn = spend > 0 && windowDays > 0 ? spend / windowDays : 0;
  const runwayDays = dailyBurn > 0 ? safeBalance / dailyBurn : null;

  let health: BalanceHealth;
  if (safeBalance <= 0) {
    health = "critical";
  } else if (runwayDays !== null && runwayDays < 3) {
    health = "critical";
  } else if (safeBalance <= floor) {
    // Tiny balance with little/no burn still warrants a nudge.
    health = "low";
  } else if (runwayDays !== null && runwayDays < 10) {
    health = "low";
  } else {
    health = "healthy";
  }

  return { dailyBurn, runwayDays, health };
}

// Compact runway label for the UI, e.g. "≈ 8 days", "< 1 day", "30+ days".
export function formatRunway(runwayDays: number | null, cap = 30): string {
  if (runwayDays === null) return "no recent burn";
  if (runwayDays < 1) return "< 1 day";
  if (runwayDays >= cap) return `${cap}+ days`;
  return `≈ ${Math.floor(runwayDays)} days`;
}

// Plan rank for upgrade/downgrade comparisons (order in PLANS is ascending).
function planRank(key: string | null | undefined): number {
  return PLANS.findIndex((p) => p.key === key);
}

export interface PlanRecommendation {
  key: PlanKey;
  reason: string;
  /** True when the recommendation is a step up from the org's current plan. */
  isUpgrade: boolean;
}

// Recommend the smallest plan whose monthly allotment covers projected burn
// (with 20% headroom). Falls back to the largest plan when burn exceeds every
// tier, and to a sensible default when there's no usage signal yet.
export function recommendPlan(
  spend30d: number,
  currentPlanKey?: string | null,
): PlanRecommendation {
  const largest = PLANS[PLANS.length - 1];
  let key: PlanKey;
  let reason: string;

  if (spend30d <= 0) {
    key = "pro";
    reason = "Balanced monthly capacity most desks start with.";
  } else {
    const need = spend30d * 1.2;
    const fit = PLANS.find((p) => p.creditsPerMonth >= need);
    key = (fit?.key ?? largest.key) as PlanKey;
    reason = fit
      ? `Covers your ${Math.round(spend30d)}-credit monthly burn with headroom.`
      : `Highest throughput for your ${Math.round(spend30d)}-credit monthly burn.`;
  }

  const isUpgrade = planRank(key) > planRank(currentPlanKey);
  return { key, reason, isUpgrade };
}

// Suggest a one-off credit pack sized to bridge the balance up to roughly one
// month of burn — for an immediate top-up without changing plans. Returns null
// when the balance already covers the projected month.
export function recommendTopUpPack(balance: number, spend30d: number): CreditPack | null {
  if (spend30d <= 0) return null;
  const gap = spend30d - Math.max(0, balance);
  if (gap <= 0) return null;
  const packs = [...CREDIT_PACKS].sort((a, b) => a.credits - b.credits);
  return packs.find((p) => p.credits >= gap) ?? packs[packs.length - 1] ?? null;
}

// Convenience for callers that only need the recommended plan definition.
export function recommendedPlanView(spend30d: number, currentPlanKey?: string | null) {
  const rec = recommendPlan(spend30d, currentPlanKey);
  return { ...rec, plan: PLAN_BY_KEY[rec.key] };
}
