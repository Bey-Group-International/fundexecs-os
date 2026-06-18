// Wallet / credits configuration. The top-bar "Balance" shows an org's credit
// balance (0 when there's no wallet yet); the Wallet page sells credit packs or
// a plan. Pricing/allotments live here; the `wallets` row holds current state.
//
// Annual = 10x the monthly price (two months free). Each plan has its own
// monthly credit allotment.

export type PlanKey = "starter" | "pro" | "scale";
export type PlanInterval = "monthly" | "annual";

export interface Plan {
  key: PlanKey;
  name: string;
  /** USD per month, billed monthly. */
  monthly: number;
  /** USD per year, billed annually (≈ 2 months free). */
  annual: number;
  /** Credits granted per month on this plan. */
  creditsPerMonth: number;
  blurb: string;
  features: string[];
}

export const PLANS: Plan[] = [
  {
    key: "starter",
    name: "Starter",
    monthly: 5,
    annual: 50,
    creditsPerMonth: 500,
    blurb: "For getting real work done solo.",
    features: ["500 credits / mo", "All six agents", "Scheduled workflows"],
  },
  {
    key: "pro",
    name: "Pro",
    monthly: 30,
    annual: 300,
    creditsPerMonth: 4_000,
    blurb: "For an active deal team.",
    features: ["4,000 credits / mo", "Priority agent runs", "Unlimited sessions & groups"],
  },
  {
    key: "scale",
    name: "Scale",
    monthly: 100,
    annual: 1_000,
    creditsPerMonth: 15_000,
    blurb: "For a firm running on FundExecs.",
    features: ["15,000 credits / mo", "Highest throughput", "Early access to new hubs"],
  },
];

export const PLAN_BY_KEY: Record<PlanKey, Plan> = Object.fromEntries(
  PLANS.map((p) => [p.key, p]),
) as Record<PlanKey, Plan>;

// One-off credit packs (no subscription).
export interface CreditPack {
  key: string;
  credits: number;
  price: number; // USD
}
export const CREDIT_PACKS: CreditPack[] = [
  { key: "pack_500", credits: 500, price: 5 },
  { key: "pack_3000", credits: 3_000, price: 25 },
  { key: "pack_12000", credits: 12_000, price: 90 },
];

export function planPrice(plan: Plan, interval: PlanInterval): number {
  return interval === "annual" ? plan.annual : plan.monthly;
}

export function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export function formatCredits(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}
