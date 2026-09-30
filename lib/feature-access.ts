// lib/feature-access.ts
// The plan gate on the operating surfaces — the pure half.
//
// Run, Execute, Marketplace, Office and Automations are open to browse for every
// signed-in member, but DOING anything in them (running an analysis, executing a
// capital action, listing, building an automation, customizing the office)
// requires the org to hold a paid plan. Orgs created before the paywall took
// effect (PAYWALL_EFFECTIVE_FROM) are grandfathered, for the same reason the
// credit wall exempts them: they signed up to an open product. Platform admins (confirmed
// @beygroupintl.com / ADMIN_EMAILS addresses, see lib/platform-admin) skip the
// gate entirely.
//
// Pure so the decision is testable and identical wherever it is asked; the
// session and wallet are resolved in lib/feature-access.server.
import { PLAN_BY_KEY, type PlanKey } from "@/lib/billing";
import { PAYWALL_EFFECTIVE_FROM } from "@/lib/paywall";

export type GatedFeature = "run" | "execute" | "marketplace" | "office" | "automations";

export const GATED_FEATURES: GatedFeature[] = ["run", "execute", "marketplace", "office", "automations"];

export const FEATURE_LABELS: Record<GatedFeature, string> = {
  run: "Run",
  execute: "Execute",
  marketplace: "Marketplace",
  office: "Office",
  automations: "Automations",
};

export interface FeatureAccessInput {
  isPlatformAdmin: boolean;
  /** wallets.plan — a PlanKey while a subscription runs; null or 'free' otherwise. */
  plan: string | null | undefined;
  /** organizations.created_at — orgs predating the paywall are exempt. */
  orgCreatedAt: string | null | undefined;
  /**
   * Whether a plan can actually be bought right now (lib/live-readiness
   * planPurchasable). Demanding a plan that cannot be purchased locks members
   * out of five surfaces with no way to pay, so the gate opens instead.
   */
  planPurchasable: boolean;
}

export interface FeatureAccess {
  /** Every gated feature is usable. */
  unlocked: boolean;
  /** Unlocked because the caller is a platform admin, not because of a plan. */
  viaAdmin: boolean;
  /** Unlocked only because the org predates the paywall. */
  grandfathered: boolean;
  /**
   * Unlocked only because no plan can currently be bought. Distinct from
   * grandfathered: this is a deployment fault, not an entitlement, and it goes
   * away the moment a live rail is configured.
   */
  unsellable: boolean;
  plan: PlanKey | null;
}

/** 'free' is the signup marker, not a paid plan; anything unknown is no plan. */
export function paidPlan(plan: string | null | undefined): PlanKey | null {
  // Own keys only: `in` would also accept inherited names like "constructor".
  return plan && Object.hasOwn(PLAN_BY_KEY, plan) ? (plan as PlanKey) : null;
}

/**
 * Whether an org was created before the paywall took effect. Unlike the credit
 * wall's isGrandfathered, an unknown or unparseable date does NOT exempt: a
 * missing org or a failed read must not open a paid feature.
 */
export function predatesPaywall(orgCreatedAt: string | null | undefined): boolean {
  if (!orgCreatedAt) return false;
  const created = new Date(orgCreatedAt).getTime();
  return Number.isFinite(created) && created < new Date(PAYWALL_EFFECTIVE_FROM).getTime();
}

/** Resolve whether the gated features are usable. */
export function evaluateFeatureAccess(input: FeatureAccessInput): FeatureAccess {
  const plan = paidPlan(input.plan);
  if (input.isPlatformAdmin) {
    return { unlocked: true, viaAdmin: true, grandfathered: false, unsellable: false, plan };
  }
  if (plan) {
    return { unlocked: true, viaAdmin: false, grandfathered: false, unsellable: false, plan };
  }
  const grandfathered = predatesPaywall(input.orgCreatedAt);
  if (grandfathered) {
    return { unlocked: true, viaAdmin: false, grandfathered: true, unsellable: false, plan };
  }
  // Nothing entitles this org, so the gate would close. Before it does, ask
  // whether the way out actually exists: a paid plan is the only remedy the
  // lock offers, and if none can be bought the lock has no remedy at all.
  //
  // Grandfathering is checked first and reported separately on purpose. It is a
  // promise kept to orgs that predate the paywall; this is a deployment fault,
  // and conflating them would hide a broken rail behind a legitimate exemption.
  const unsellable = !input.planPurchasable;
  return { unlocked: unsellable, viaAdmin: false, grandfathered: false, unsellable, plan };
}

/** Whether a hub key is one of the gated hubs. */
export function gatedFeatureForHub(hub: string): GatedFeature | null {
  return hub === "run" || hub === "execute" ? hub : null;
}

/** The message a locked action returns, and the banner repeats. */
export function featureLockedMessage(feature: GatedFeature): string {
  return `${FEATURE_LABELS[feature]} requires a paid plan. Choose a plan in Wallet to unlock it.`;
}
