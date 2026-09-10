// lib/paywall.ts
// The credit wall — the pure half.
//
// The product stays open until an action cannot be paid for. That moment is the
// wall: not a plan check, not a locked feature, just "this costs 3 credits and
// you have 1". It resolves in place, and choosing a plan clears it immediately
// rather than after a bank transfer settles — see UNLOCK ON COMMITMENT below.
//
// Everything here is pure so the decision is testable and identical wherever it
// is asked; the org's actual state is resolved in lib/paywall.server.
import { PLANS, PLAN_BY_KEY, type PlanKey } from "@/lib/billing";

/**
 * Organizations created before this instant never hit the wall.
 *
 * People who were already using the product did not agree to a paywall, and a
 * deploy is not the moment to tell them. New signups meet it from day one.
 */
export const PAYWALL_EFFECTIVE_FROM = "2026-09-10T00:00:00.000Z";

/** Whether an org predates the wall and is therefore exempt from it. */
export function isGrandfathered(orgCreatedAt: string | null | undefined): boolean {
  if (!orgCreatedAt) return true; // Unknown age: never wall someone by accident.
  const created = new Date(orgCreatedAt).getTime();
  if (!Number.isFinite(created)) return true;
  return created < new Date(PAYWALL_EFFECTIVE_FROM).getTime();
}

export type PaywallReason = "insufficient_credits";

export interface PaywallInput {
  balance: number;
  /** What the blocked action costs. */
  required: number;
  orgCreatedAt: string | null | undefined;
  /** The org already has a plan running. */
  hasPlan: boolean;
  /**
   * A previous period was never paid for (an invoice written off). Such an org
   * does not get another period on credit — see UNLOCK ON COMMITMENT.
   */
  hasUnpaidHistory: boolean;
  /** Recent 30-day burn, used to size the recommendation. */
  recentSpend?: number;
}

export interface PaywallState {
  /** The action cannot proceed. */
  walled: boolean;
  reason: PaywallReason | null;
  balance: number;
  required: number;
  shortfall: number;
  /** Exempt because the org predates the wall. */
  grandfathered: boolean;
  /** The plan to put in front of them. */
  recommendedPlan: PlanKey | null;
  /**
   * UNLOCK ON COMMITMENT — choosing a plan grants the period's credits straight
   * away, with the invoice outstanding. This is what makes the wall clearable in
   * one click when settlement is a bank transfer that takes days to land; the
   * exposure is one period's credits, and dunning closes a subscription that is
   * never paid for.
   *
   * False for an org that already has an unpaid period behind it: extending
   * credit twice to someone who did not settle the first time is how a capped
   * exposure stops being capped.
   */
  canUnlockOnCommitment: boolean;
}

/**
 * The smallest plan whose monthly credits cover both the blocked action and the
 * org's recent burn. Recommending a plan too small to clear the wall would put
 * someone through checkout and leave them exactly where they started.
 */
export function recommendedPlanFor(shortfall: number, recentSpend = 0): PlanKey {
  const needed = Math.max(shortfall, recentSpend);
  const fits = PLANS.find((p) => p.creditsPerMonth >= needed);
  return (fits ?? PLANS[PLANS.length - 1]).key;
}

/** Resolve whether an action is walled, and what to offer if it is. */
export function evaluatePaywall(input: PaywallInput): PaywallState {
  const grandfathered = isGrandfathered(input.orgCreatedAt);
  const shortfall = Math.max(0, input.required - input.balance);
  const affordable = input.balance >= input.required;

  // Whether this org may take a period on credit is a fact about the ORG, not
  // about the price of whatever it just tried to do. Computing it only in the
  // walled branch made the eligibility check (which asks with required: 0, and
  // so always looks affordable) refuse every commit.
  //
  // An org already on a plan that has run its credits down is topping up rather
  // than subscribing, and one with an unpaid period behind it does not get a
  // second: extending credit twice to someone who did not settle the first time
  // is how a capped exposure stops being capped.
  const canUnlockOnCommitment = !input.hasUnpaidHistory && !input.hasPlan;

  // Not walled: either they can pay for it, or they predate the wall entirely.
  if (affordable || grandfathered) {
    return {
      walled: false,
      reason: null,
      balance: input.balance,
      required: input.required,
      shortfall,
      grandfathered,
      recommendedPlan: null,
      canUnlockOnCommitment,
    };
  }

  return {
    walled: true,
    reason: "insufficient_credits",
    balance: input.balance,
    required: input.required,
    shortfall,
    grandfathered,
    recommendedPlan: recommendedPlanFor(shortfall, input.recentSpend ?? 0),
    canUnlockOnCommitment,
  };
}

/**
 * What the operator is told at the wall. Names the number, the plan, and what
 * happens next — a wall that only says "insufficient credits" leaves someone
 * guessing at the size of the problem.
 */
export function paywallMessage(state: PaywallState): string {
  if (!state.walled) return "";
  const plan = state.recommendedPlan ? PLAN_BY_KEY[state.recommendedPlan] : null;
  const head = `This needs ${state.required} credits and you have ${state.balance}.`;
  if (!plan) return head;
  if (state.canUnlockOnCommitment) {
    return `${head} Start ${plan.name} to continue right now — we'll invoice you, and your credits are available immediately.`;
  }
  return `${head} Add credits or settle your outstanding invoice to continue.`;
}

/** The shape a blocked API response carries so a client can render the wall. */
export interface PaywallPayload {
  reason: PaywallReason;
  balance: number;
  required: number;
  recommendedPlan: PlanKey | null;
  canUnlockOnCommitment: boolean;
  message: string;
}

export function paywallPayload(state: PaywallState): PaywallPayload | null {
  if (!state.walled || !state.reason) return null;
  return {
    reason: state.reason,
    balance: state.balance,
    required: state.required,
    recommendedPlan: state.recommendedPlan,
    canUnlockOnCommitment: state.canUnlockOnCommitment,
    message: paywallMessage(state),
  };
}
