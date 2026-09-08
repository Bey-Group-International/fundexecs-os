// lib/subscriptions.ts
// The subscription state machine, as pure functions.
//
// FundExecs owns the billing period — a payment processor is only a rail that
// settles a charge (see lib/billing-rail). Everything about WHEN a period ends,
// what a plan change costs, and what a failed charge does next is decided here,
// so it is testable without a database or a network. The DB side lives in
// lib/subscriptions.server.
import {
  PLAN_BY_KEY,
  planPrice,
  planGrantCredits,
  type PlanInterval,
  type PlanKey,
} from "@/lib/billing";

export type SubscriptionStatus = "active" | "past_due" | "canceled";

export interface Subscription {
  id: string;
  organization_id: string;
  plan: PlanKey;
  interval: PlanInterval;
  status: SubscriptionStatus;
  price_usd: number;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  ended_at: string | null;
  pending_plan: PlanKey | null;
  pending_interval: PlanInterval | null;
  failed_attempts: number;
  last_payment_error: string | null;
  next_attempt_at: string | null;
  processor: string;
  processor_customer_id: string | null;
  processor_subscription_id: string | null;
  started_at: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Period math
// ---------------------------------------------------------------------------

// Add whole calendar months, clamping the day so Jan 31 + 1 month is Feb 28/29
// rather than spilling into March. Date#setMonth would spill; billing must not.
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const targetMonth = d.getMonth() + months;
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(targetMonth);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/** The end of a billing period that starts at `start`. */
export function periodEnd(start: Date, interval: PlanInterval): Date {
  return addMonths(start, interval === "annual" ? 12 : 1);
}

/**
 * The billing period containing `now`, anchored on the subscription's original
 * start date.
 *
 * Anchoring matters: stepping month-by-month from the PREVIOUS period would let
 * a clamped short month drift the billing day permanently (Jan 31 → Feb 28 →
 * Mar 28 → …). Measuring every period from the anchor instead means February
 * borrows the 28th and March gets the 31st back.
 *
 * It also means a sweep that has been down for three cycles advances to the
 * current period in one step, rather than billing once per missed cycle for
 * value that was never delivered.
 */
export function advancePeriod(
  anchor: Date,
  interval: PlanInterval,
  now: Date,
): { start: Date; end: Date } {
  const step = interval === "annual" ? 12 : 1;
  let k = 1;
  // Bounded: 400 monthly steps is ~33 years, far past any real backlog.
  while (k < 400 && addMonths(anchor, k * step).getTime() <= now.getTime()) k += 1;
  return { start: addMonths(anchor, (k - 1) * step), end: addMonths(anchor, k * step) };
}

/** Whether a period has elapsed and the subscription is due to renew. */
export function isDue(sub: Pick<Subscription, "current_period_end">, now: Date): boolean {
  return new Date(sub.current_period_end).getTime() <= now.getTime();
}

/** Whole days left in the current period (0 when it has elapsed). */
export function daysRemaining(sub: Pick<Subscription, "current_period_end">, now: Date): number {
  const ms = new Date(sub.current_period_end).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

// ---------------------------------------------------------------------------
// Plan changes
// ---------------------------------------------------------------------------

// Plans ranked by price so an upgrade and a downgrade can be told apart. A change
// of interval at the same tier (monthly → annual) counts as an upgrade because
// the operator is paying more up front for more credits.
const PLAN_RANK: Record<PlanKey, number> = { starter: 0, pro: 1, scale: 2 };

export type ChangeDirection = "upgrade" | "downgrade" | "same";

export function changeDirection(
  from: { plan: PlanKey; interval: PlanInterval },
  to: { plan: PlanKey; interval: PlanInterval },
): ChangeDirection {
  if (from.plan === to.plan && from.interval === to.interval) return "same";
  if (PLAN_RANK[to.plan] !== PLAN_RANK[from.plan]) {
    return PLAN_RANK[to.plan] > PLAN_RANK[from.plan] ? "upgrade" : "downgrade";
  }
  // Same tier, different interval: annual is the upgrade.
  return to.interval === "annual" ? "upgrade" : "downgrade";
}

export interface ProratedUpgrade {
  /** USD to charge now for the remainder of the current period. */
  amountUsd: number;
  /** Credits to grant now — the plan difference, prorated the same way. */
  credits: number;
  /** Fraction of the current period still unused, 0–1. */
  unusedFraction: number;
}

/**
 * What an immediate upgrade costs, mid-period.
 *
 * The operator has already paid for — and been granted credits for — the whole
 * current period. So they are charged only the price DIFFERENCE for the unused
 * remainder, and granted only the credit difference for that same remainder.
 * Credits already granted are never clawed back (they may already be spent), and
 * the period end does not move: the upgrade rides out the cycle they paid for.
 */
export function prorateUpgrade(
  sub: Pick<Subscription, "plan" | "interval" | "current_period_start" | "current_period_end">,
  to: { plan: PlanKey; interval: PlanInterval },
  now: Date,
): ProratedUpgrade {
  const start = new Date(sub.current_period_start).getTime();
  const end = new Date(sub.current_period_end).getTime();
  const span = end - start;
  const unusedFraction =
    span <= 0 ? 0 : Math.min(1, Math.max(0, (end - now.getTime()) / span));

  const fromPlan = PLAN_BY_KEY[sub.plan];
  const toPlan = PLAN_BY_KEY[to.plan];
  if (!fromPlan || !toPlan) return { amountUsd: 0, credits: 0, unusedFraction };

  const priceDelta = planPrice(toPlan, to.interval) - planPrice(fromPlan, sub.interval);
  const creditDelta = planGrantCredits(toPlan, to.interval) - planGrantCredits(fromPlan, sub.interval);

  return {
    // Round to cents; never charge a negative amount (an "upgrade" that prices
    // lower is settled as zero rather than as a refund).
    amountUsd: Math.max(0, Math.round(priceDelta * unusedFraction * 100) / 100),
    credits: Math.max(0, Math.round(creditDelta * unusedFraction)),
    unusedFraction,
  };
}

/**
 * The plan/interval a subscription renews INTO — a scheduled downgrade applied,
 * or the current plan when nothing is pending.
 */
export function renewalTarget(
  sub: Pick<Subscription, "plan" | "interval" | "pending_plan" | "pending_interval">,
): { plan: PlanKey; interval: PlanInterval } {
  return {
    plan: sub.pending_plan ?? sub.plan,
    interval: sub.pending_interval ?? sub.interval,
  };
}

/** Price of the subscription's next renewal, in USD. */
export function renewalPrice(
  sub: Pick<Subscription, "plan" | "interval" | "pending_plan" | "pending_interval">,
): number {
  const target = renewalTarget(sub);
  const plan = PLAN_BY_KEY[target.plan];
  return plan ? planPrice(plan, target.interval) : 0;
}

/** Credits granted at the next renewal. */
export function renewalCredits(
  sub: Pick<Subscription, "plan" | "interval" | "pending_plan" | "pending_interval">,
): number {
  const target = renewalTarget(sub);
  const plan = PLAN_BY_KEY[target.plan];
  return plan ? planGrantCredits(plan, target.interval) : 0;
}

// ---------------------------------------------------------------------------
// Dunning
// ---------------------------------------------------------------------------

// A failed renewal charge is retried on this schedule (days after the failure).
// Mirrors the industry-standard "three tries over a week" — long enough for an
// expiring card to be replaced, short enough that unpaid access does not run
// indefinitely. Every one of these dates is a real charge attempt: the last of
// them decides whether the subscription survives, so a card added at any point
// in the window can still save it.
export const RETRY_SCHEDULE_DAYS = [1, 3, 5];
export const PAST_DUE_MAX_ATTEMPTS = RETRY_SCHEDULE_DAYS.length;

/**
 * When to retry after `attempts` consecutive failures, or null when the
 * subscription has exhausted its retries and should be closed.
 */
export function nextAttemptAt(attempts: number, from: Date): Date | null {
  const days = RETRY_SCHEDULE_DAYS[attempts - 1];
  if (days === undefined) return null;
  return new Date(from.getTime() + days * 86_400_000);
}

/**
 * Whether the NEXT scheduled charge is this subscription's last: the retry
 * budget is down to its final entry, so a failure then closes the plan.
 *
 * Note this is a warning state, not a death sentence — the attempt still
 * happens, and a payment method added before it goes through. (This replaced
 * `isExhausted`, which named the old behaviour where the subscription was
 * closed WITHOUT that final attempt ever being made.)
 */
export function isFinalAttempt(sub: Pick<Subscription, "failed_attempts">): boolean {
  return sub.failed_attempts >= PAST_DUE_MAX_ATTEMPTS;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export type SubscriptionHealth = "active" | "ending" | "past_due" | "none";

export function subscriptionHealth(sub: Subscription | null): SubscriptionHealth {
  if (!sub || sub.status === "canceled") return "none";
  if (sub.status === "past_due") return "past_due";
  return sub.cancel_at_period_end ? "ending" : "active";
}

/** "September 7, 2026" — the renewal / end date as operators read it. */
export function formatBillingDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** One line describing what happens next, for the Wallet panel. */
export function nextBillingSummary(sub: Subscription | null, now: Date = new Date()): string {
  if (!sub || sub.status === "canceled") return "No active subscription.";
  const when = formatBillingDate(sub.current_period_end);
  if (sub.status === "past_due") {
    // Every retry date is a real attempt, so "we'll retry" is honest — but the
    // last one decides the plan, and saying so is the difference between an
    // operator acting in time and finding out afterwards.
    const attemptOn = sub.next_attempt_at ? formatBillingDate(sub.next_attempt_at) : null;
    if (isFinalAttempt(sub)) {
      return attemptOn
        ? `Payment failed ${sub.failed_attempts} times. We'll make one final attempt on ${attemptOn} — update your payment method before then to keep this plan.`
        : "Payment failed. The next attempt is the last — update your payment method to keep this plan.";
    }
    return attemptOn
      ? `Payment failed. We'll retry on ${attemptOn}.`
      : "Payment failed. Update your payment method to keep this plan.";
  }
  if (sub.cancel_at_period_end) {
    return `Cancels on ${when} — ${daysRemaining(sub, now)} day(s) of access left.`;
  }
  const target = renewalTarget(sub);
  const plan = PLAN_BY_KEY[target.plan];
  const changing = sub.pending_plan || sub.pending_interval;
  return changing && plan
    ? `Switches to ${plan.name} (${target.interval}) on ${when}.`
    : `Renews on ${when}.`;
}
