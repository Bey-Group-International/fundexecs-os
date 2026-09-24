// lib/feature-access.ts
// The plan gate on the operating surfaces — the pure half.
//
// Run, Execute, Marketplace, Office and Automations are open to browse for every
// signed-in member, but DOING anything in them (running an analysis, executing a
// capital action, listing, building an automation, customizing the office)
// requires the org to hold a paid plan. Platform admins (confirmed
// @beygroupintl.com / ADMIN_EMAILS addresses, see lib/platform-admin) skip the
// gate entirely.
//
// Pure so the decision is testable and identical wherever it is asked; the
// session and wallet are resolved in lib/feature-access.server.
import { PLAN_BY_KEY, type PlanKey } from "@/lib/billing";

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
}

export interface FeatureAccess {
  /** Every gated feature is usable. */
  unlocked: boolean;
  /** Unlocked because the caller is a platform admin, not because of a plan. */
  viaAdmin: boolean;
  plan: PlanKey | null;
}

/** 'free' is the signup marker, not a paid plan; anything unknown is no plan. */
export function paidPlan(plan: string | null | undefined): PlanKey | null {
  return plan && plan in PLAN_BY_KEY ? (plan as PlanKey) : null;
}

/** Resolve whether the gated features are usable. */
export function evaluateFeatureAccess(input: FeatureAccessInput): FeatureAccess {
  const plan = paidPlan(input.plan);
  if (input.isPlatformAdmin) return { unlocked: true, viaAdmin: true, plan };
  return { unlocked: plan !== null, viaAdmin: false, plan };
}

/** Whether a hub key is one of the gated hubs. */
export function gatedFeatureForHub(hub: string): GatedFeature | null {
  return hub === "run" || hub === "execute" ? hub : null;
}

/** The message a locked action returns, and the banner repeats. */
export function featureLockedMessage(feature: GatedFeature): string {
  return `${FEATURE_LABELS[feature]} requires a paid plan. Choose a plan in Wallet to unlock it.`;
}
