// lib/subscriptions.server.ts
// The subscription lifecycle against the database.
//
// Every mutation an operator can make to their plan — subscribe, upgrade,
// schedule a downgrade, cancel, resume — and the renewal sweep that keeps the
// whole thing turning, live here. Period math and pricing decisions come from
// lib/subscriptions (pure); money is settled through lib/billing-rail; credits
// are granted through lib/credits so the Credit History ledger records every
// grant regardless of which path produced it.
//
// Writes go through the service-role client on purpose: `subscriptions` has no
// RLS write policy, so an org member cannot hand themselves a plan or a period
// extension by talking to the database directly.
import { createServiceClient, createServerClient } from "@/lib/supabase/server";
import { grantCredits } from "@/lib/credits";
import { awardReferralOnSubscription } from "@/lib/gift-earn";
import { chargeSubscription, activeRail } from "@/lib/billing-rail";
import {
  PLAN_BY_KEY,
  planPrice,
  planGrantCredits,
  loyaltyBonus,
  tenureMonths,
  type PlanInterval,
  type PlanKey,
} from "@/lib/billing";
import {
  advancePeriod,
  changeDirection,
  isExhausted,
  nextAttemptAt,
  periodEnd,
  prorateUpgrade,
  renewalTarget,
  type Subscription,
} from "@/lib/subscriptions";

type ServiceClient = ReturnType<typeof createServiceClient>;

const LIVE_STATUSES = ["active", "past_due"] as const;

export interface LifecycleResult {
  ok: boolean;
  error?: string;
  subscription?: Subscription;
  /** Credits granted by this operation, when any. */
  credits?: number;
  /** Set when the operator must come back and pay interactively. */
  requiresPayment?: boolean;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The org's live subscription (active or past_due), or null. Reader-scoped. */
export async function getSubscription(orgId: string): Promise<Subscription | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("organization_id", orgId)
    .in("status", LIVE_STATUSES as unknown as string[])
    .maybeSingle();
  return (data as Subscription | null) ?? null;
}

/** Same read, service-role — for server paths with no user session (cron, fulfillment). */
async function getSubscriptionService(
  service: ServiceClient,
  orgId: string,
): Promise<Subscription | null> {
  const { data } = await service
    .from("subscriptions")
    .select("*")
    .eq("organization_id", orgId)
    .in("status", LIVE_STATUSES as unknown as string[])
    .maybeSingle();
  return (data as Subscription | null) ?? null;
}

export interface SubscriptionEvent {
  id: string;
  kind: string;
  plan: string | null;
  interval: string | null;
  amount_usd: number;
  credits_granted: number;
  note: string | null;
  created_at: string;
}

/** Recent billing history for the Wallet page. */
export async function listSubscriptionEvents(
  orgId: string,
  limit = 12,
): Promise<SubscriptionEvent[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("subscription_events")
    .select("id, kind, plan, interval, amount_usd, credits_granted, note, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as SubscriptionEvent[] | null) ?? [];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function recordEvent(
  service: ServiceClient,
  row: {
    orgId: string;
    subscriptionId: string | null;
    kind: string;
    plan?: string | null;
    interval?: string | null;
    amountUsd?: number;
    credits?: number;
    reference?: string | null;
    note?: string | null;
  },
): Promise<void> {
  const { error } = await service.from("subscription_events").insert({
    organization_id: row.orgId,
    subscription_id: row.subscriptionId,
    kind: row.kind,
    plan: row.plan ?? null,
    interval: row.interval ?? null,
    amount_usd: row.amountUsd ?? 0,
    credits_granted: row.credits ?? 0,
    reference: row.reference ?? null,
    note: row.note ?? null,
  });
  // A duplicate renewal reference means another sweep already booked this period
  // — that's the unique index doing its job, so let the caller see it.
  if (error) throw new Error(error.message);
}

// Mirror the subscription's entitlement onto the wallet. `wallets.plan` is what
// every other surface (top bar, seat limits, feature gates) already reads, so it
// must never drift from the subscription that justifies it.
async function syncWalletPlan(
  service: ServiceClient,
  orgId: string,
  fields: {
    plan: PlanKey | null;
    interval: PlanInterval | null;
    /** Preserve the original start so loyalty tenure keeps accruing. */
    startedAt?: string;
    processorCustomerId?: string | null;
    paymentMethodId?: string | null;
  },
): Promise<void> {
  const { data: existing } = await service
    .from("wallets")
    .select("plan_started_at")
    .eq("organization_id", orgId)
    .maybeSingle();

  await service.from("wallets").upsert(
    {
      organization_id: orgId,
      plan: fields.plan,
      plan_interval: fields.interval,
      // Clearing the plan clears tenure; otherwise the first activation wins.
      plan_started_at: fields.plan
        ? existing?.plan_started_at ?? fields.startedAt ?? new Date().toISOString()
        : null,
      ...(fields.processorCustomerId ? { stripe_customer_id: fields.processorCustomerId } : {}),
      ...(fields.paymentMethodId ? { stripe_payment_method_id: fields.paymentMethodId } : {}),
    },
    { onConflict: "organization_id" },
  );
}

export interface StartSubscriptionInput {
  orgId: string;
  planKey: PlanKey;
  interval: PlanInterval;
  createdBy?: string | null;
  /** Processor identifiers captured at checkout, so renewals can be charged. */
  processorCustomerId?: string | null;
  paymentMethodId?: string | null;
  processor?: string;
  /** A Stripe-managed (mode=subscription) legacy subscription; the sweep skips it. */
  processorSubscriptionId?: string | null;
  /** Reference for the charge that already paid for this first period. */
  reference?: string | null;
  note?: string;
  /** Present the first period as already settled (checkout collected it). */
  alreadyPaid?: boolean;
}

/**
 * Start a subscription for an org — the first period.
 *
 * Idempotent by org: if a live subscription already exists this routes into
 * `changePlan` instead of opening a second one. That is the invariant the old
 * flow lacked, and it is what stopped a plan switch from double-billing.
 */
export async function startSubscription(
  input: StartSubscriptionInput,
  client?: ServiceClient,
): Promise<LifecycleResult> {
  const service = client ?? createServiceClient();
  const plan = PLAN_BY_KEY[input.planKey];
  if (!plan) return { ok: false, error: "Unknown plan" };

  const existing = await getSubscriptionService(service, input.orgId);
  if (existing) {
    // Already subscribed — this is a change, not a new subscription. Payment for
    // the difference is handled there.
    return changePlan(
      { orgId: input.orgId, planKey: input.planKey, interval: input.interval, prepaid: input.alreadyPaid },
      service,
    );
  }

  const now = new Date();
  const price = planPrice(plan, input.interval);

  // Checkout collected the first period; the rail only runs when it didn't
  // (the native in-app path, or a plan started server-side).
  let reference = input.reference ?? null;
  if (!input.alreadyPaid) {
    const charge = await chargeSubscription({
      orgId: input.orgId,
      amountUsd: price,
      description: `FundExecs OS — ${plan.name} plan (${input.interval})`,
      customerId: input.processorCustomerId,
      paymentMethodId: input.paymentMethodId,
      idempotencyKey: `start:${input.orgId}:${input.planKey}:${input.interval}:${now.toISOString().slice(0, 13)}`,
    });
    if (!charge.ok) {
      return { ok: false, error: charge.error, requiresPayment: charge.requiresAction };
    }
    reference = charge.reference ?? null;
  }

  const { data, error } = await service
    .from("subscriptions")
    .insert({
      organization_id: input.orgId,
      plan: input.planKey,
      interval: input.interval,
      status: "active",
      price_usd: price,
      current_period_start: now.toISOString(),
      current_period_end: periodEnd(now, input.interval).toISOString(),
      processor: input.processor ?? activeRail(),
      processor_customer_id: input.processorCustomerId ?? null,
      processor_subscription_id: input.processorSubscriptionId ?? null,
      started_at: now.toISOString(),
      created_by: input.createdBy ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    // The partial unique index rejects a second live subscription — a concurrent
    // double-submit lands here, and the right answer is the one that won.
    const current = await getSubscriptionService(service, input.orgId);
    if (current) return { ok: true, subscription: current };
    console.error("[subscriptions] start failed:", error);
    return { ok: false, error: "Could not start the subscription. Please try again." };
  }

  const sub = data as Subscription;
  const credits = planGrantCredits(plan, input.interval);
  await grantCredits(service, input.orgId, credits, "plan_grant", {
    note: input.note ?? `${plan.name} plan (${input.interval})`,
  });
  await syncWalletPlan(service, input.orgId, {
    plan: input.planKey,
    interval: input.interval,
    startedAt: now.toISOString(),
    processorCustomerId: input.processorCustomerId,
    paymentMethodId: input.paymentMethodId,
  });
  await recordEvent(service, {
    orgId: input.orgId,
    subscriptionId: sub.id,
    kind: "created",
    plan: input.planKey,
    interval: input.interval,
    amountUsd: price,
    credits,
    reference,
    note: `${plan.name} plan started`,
  });

  // Settle any pending referral chain now that the org is a subscriber.
  try {
    await awardReferralOnSubscription(input.orgId, service);
  } catch (err) {
    console.error("[referral] awardReferralOnSubscription failed:", err);
  }

  return { ok: true, subscription: sub, credits };
}

export interface ChangePlanInput {
  orgId: string;
  planKey: PlanKey;
  interval: PlanInterval;
  /** The prorated difference was already collected (interactive checkout). */
  prepaid?: boolean;
}

/**
 * Move a live subscription to a different plan or interval.
 *
 * Upgrades apply immediately: the operator is charged the prorated price
 * difference for the unused remainder of the period, and granted the matching
 * prorated credit difference. The period end does not move.
 *
 * Downgrades are scheduled for the next renewal. Credits already granted are
 * never clawed back — they may well be spent — so cutting a plan short would
 * mean taking back value the operator paid for.
 */
export async function changePlan(
  input: ChangePlanInput,
  client?: ServiceClient,
): Promise<LifecycleResult> {
  const service = client ?? createServiceClient();
  const plan = PLAN_BY_KEY[input.planKey];
  if (!plan) return { ok: false, error: "Unknown plan" };

  const sub = await getSubscriptionService(service, input.orgId);
  if (!sub) {
    return startSubscription(
      { orgId: input.orgId, planKey: input.planKey, interval: input.interval, alreadyPaid: input.prepaid },
      service,
    );
  }

  const now = new Date();
  const target = { plan: input.planKey, interval: input.interval };
  const direction = changeDirection({ plan: sub.plan, interval: sub.interval }, target);

  if (direction === "same") {
    // Re-choosing the current plan clears a scheduled downgrade — that is what
    // an operator means when they pick their own plan again.
    if (sub.pending_plan || sub.pending_interval) {
      const { data } = await service
        .from("subscriptions")
        .update({ pending_plan: null, pending_interval: null })
        .eq("id", sub.id)
        .select("*")
        .single();
      await recordEvent(service, {
        orgId: input.orgId,
        subscriptionId: sub.id,
        kind: "resumed",
        plan: sub.plan,
        interval: sub.interval,
        note: "Scheduled plan change cancelled",
      });
      return { ok: true, subscription: (data as Subscription) ?? sub };
    }
    return { ok: true, subscription: sub };
  }

  if (direction === "downgrade") {
    const { data, error } = await service
      .from("subscriptions")
      .update({ pending_plan: input.planKey, pending_interval: input.interval })
      .eq("id", sub.id)
      .select("*")
      .single();
    if (error) return { ok: false, error: "Could not schedule the plan change." };
    await recordEvent(service, {
      orgId: input.orgId,
      subscriptionId: sub.id,
      kind: "downgrade_scheduled",
      plan: input.planKey,
      interval: input.interval,
      note: `Switches to ${plan.name} at renewal`,
    });
    return { ok: true, subscription: data as Subscription };
  }

  // Upgrade — charge and grant the prorated difference now.
  const proration = prorateUpgrade(sub, target, now);
  let reference: string | null = null;
  if (!input.prepaid && proration.amountUsd > 0) {
    const charge = await chargeSubscription({
      orgId: input.orgId,
      amountUsd: proration.amountUsd,
      description: `FundExecs OS — upgrade to ${plan.name} (prorated)`,
      customerId: sub.processor_customer_id,
      paymentMethodId: await paymentMethodFor(service, input.orgId),
      idempotencyKey: `upgrade:${sub.id}:${input.planKey}:${input.interval}:${sub.current_period_start}`,
    });
    if (!charge.ok) {
      return { ok: false, error: charge.error, requiresPayment: charge.requiresAction };
    }
    reference = charge.reference ?? null;
  }

  const { data, error } = await service
    .from("subscriptions")
    .update({
      plan: input.planKey,
      interval: input.interval,
      price_usd: planPrice(plan, input.interval),
      // An upgrade supersedes any scheduled downgrade.
      pending_plan: null,
      pending_interval: null,
    })
    .eq("id", sub.id)
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: "Could not change the plan. Please try again." };

  if (proration.credits > 0) {
    await grantCredits(service, input.orgId, proration.credits, "plan_grant", {
      note: `Upgrade to ${plan.name} — prorated credits`,
    });
  }
  await syncWalletPlan(service, input.orgId, { plan: input.planKey, interval: input.interval });
  await recordEvent(service, {
    orgId: input.orgId,
    subscriptionId: sub.id,
    kind: "upgraded",
    plan: input.planKey,
    interval: input.interval,
    amountUsd: proration.amountUsd,
    credits: proration.credits,
    reference,
    note: `Upgraded to ${plan.name} (${input.interval})`,
  });

  return { ok: true, subscription: data as Subscription, credits: proration.credits };
}

/** Cancel at period end — access continues through the period already paid for. */
export async function cancelSubscription(
  orgId: string,
  client?: ServiceClient,
): Promise<LifecycleResult> {
  const service = client ?? createServiceClient();
  const sub = await getSubscriptionService(service, orgId);
  if (!sub) return { ok: false, error: "No active subscription to cancel." };
  if (sub.cancel_at_period_end) return { ok: true, subscription: sub };

  const { data, error } = await service
    .from("subscriptions")
    .update({ cancel_at_period_end: true, canceled_at: new Date().toISOString() })
    .eq("id", sub.id)
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: "Could not cancel. Please try again." };

  await recordEvent(service, {
    orgId,
    subscriptionId: sub.id,
    kind: "canceled",
    plan: sub.plan,
    interval: sub.interval,
    note: "Cancels at the end of the current period",
  });
  return { ok: true, subscription: data as Subscription };
}

/** Undo a pending cancellation while the period is still running. */
export async function resumeSubscription(
  orgId: string,
  client?: ServiceClient,
): Promise<LifecycleResult> {
  const service = client ?? createServiceClient();
  const sub = await getSubscriptionService(service, orgId);
  if (!sub) return { ok: false, error: "No subscription to resume." };
  if (!sub.cancel_at_period_end) return { ok: true, subscription: sub };

  const { data, error } = await service
    .from("subscriptions")
    .update({ cancel_at_period_end: false, canceled_at: null })
    .eq("id", sub.id)
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: "Could not resume. Please try again." };

  await recordEvent(service, {
    orgId,
    subscriptionId: sub.id,
    kind: "resumed",
    plan: sub.plan,
    interval: sub.interval,
    note: "Cancellation withdrawn — the plan will renew",
  });
  return { ok: true, subscription: data as Subscription };
}

/** The saved payment instrument for off-session charges, if any. */
async function paymentMethodFor(service: ServiceClient, orgId: string): Promise<string | null> {
  const { data } = await service
    .from("wallets")
    .select("stripe_payment_method_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  return (data as { stripe_payment_method_id?: string | null } | null)?.stripe_payment_method_id ?? null;
}

/** Record a payment instrument captured at checkout, for future renewals. */
export async function savePaymentMethod(
  service: ServiceClient,
  orgId: string,
  paymentMethodId: string | null,
  customerId: string | null,
): Promise<void> {
  if (!paymentMethodId && !customerId) return;
  await service.from("wallets").upsert(
    {
      organization_id: orgId,
      ...(paymentMethodId ? { stripe_payment_method_id: paymentMethodId } : {}),
      ...(customerId ? { stripe_customer_id: customerId } : {}),
    },
    { onConflict: "organization_id" },
  );
  if (customerId) {
    await service
      .from("subscriptions")
      .update({ processor_customer_id: customerId })
      .eq("organization_id", orgId)
      .in("status", LIVE_STATUSES as unknown as string[]);
  }
}

// ---------------------------------------------------------------------------
// Renewal sweep
// ---------------------------------------------------------------------------

export interface RenewalStats {
  due: number;
  renewed: number;
  failed: number;
  ended: number;
  credits: number;
}

/**
 * Renew every subscription whose period has elapsed. Called from the hourly
 * /api/cron sweep — this is what makes a subscription actually recur.
 *
 * For each due row: close it if it was cancelled or has exhausted its retries,
 * apply any scheduled downgrade, charge the rail for the next period, grant the
 * plan's credits plus the tenure bonus, and advance the period. A charge failure
 * moves the row to past_due with a retry scheduled rather than cutting access
 * off at the first decline.
 */
export async function runSubscriptionRenewals(
  service: ServiceClient,
  now: Date = new Date(),
  opts: { limit?: number } = {},
): Promise<RenewalStats> {
  const stats: RenewalStats = { due: 0, renewed: 0, failed: 0, ended: 0, credits: 0 };

  const { data, error } = await service
    .from("subscriptions")
    .select("*")
    .in("status", LIVE_STATUSES as unknown as string[])
    // Stripe-managed legacy rows bill on Stripe's own schedule; the webhook
    // grants their credits, so renewing them here would double-charge.
    .is("processor_subscription_id", null)
    .lte("current_period_end", now.toISOString())
    .order("current_period_end", { ascending: true })
    .limit(opts.limit ?? 100);

  if (error) {
    console.error("[subscriptions] renewal query failed:", error);
    return stats;
  }

  const due = (data ?? []) as Subscription[];
  stats.due = due.length;

  for (const sub of due) {
    try {
      // A past_due row waits for its scheduled retry rather than being hammered
      // once an hour.
      if (
        sub.status === "past_due" &&
        sub.next_attempt_at &&
        new Date(sub.next_attempt_at).getTime() > now.getTime()
      ) {
        stats.due -= 1;
        continue;
      }

      if (sub.cancel_at_period_end || isExhausted(sub)) {
        await endSubscription(
          service,
          sub,
          sub.cancel_at_period_end ? "Cancelled by the operator" : "Payment could not be collected",
          now,
        );
        stats.ended += 1;
        continue;
      }

      const result = await renewOne(service, sub, now);
      if (result.ok) {
        stats.renewed += 1;
        stats.credits += result.credits ?? 0;
      } else {
        stats.failed += 1;
      }
    } catch (err) {
      console.error("[subscriptions] renewal failed", sub.id, err);
      stats.failed += 1;
    }
  }

  return stats;
}

// Renew a single subscription: charge, grant, advance.
async function renewOne(
  service: ServiceClient,
  sub: Subscription,
  now: Date,
): Promise<LifecycleResult> {
  const target = renewalTarget(sub);
  const plan = PLAN_BY_KEY[target.plan];
  if (!plan) {
    // The plan was retired out from under an existing subscriber; close the row
    // rather than looping on it forever.
    await endSubscription(service, sub, "Plan no longer offered", now);
    return { ok: false, error: "Unknown plan" };
  }

  const price = planPrice(plan, target.interval);
  const charge = await chargeSubscription({
    orgId: sub.organization_id,
    amountUsd: price,
    description: `FundExecs OS — ${plan.name} plan renewal (${target.interval})`,
    customerId: sub.processor_customer_id,
    paymentMethodId: await paymentMethodFor(service, sub.organization_id),
    // Keyed on the period being paid for, so a re-run of the sweep settles the
    // same charge rather than a second one.
    idempotencyKey: `renew:${sub.id}:${sub.current_period_end}`,
  });

  if (!charge.ok) {
    const attempts = sub.failed_attempts + 1;
    const retry = nextAttemptAt(attempts, now);
    await service
      .from("subscriptions")
      .update({
        status: "past_due",
        failed_attempts: attempts,
        last_payment_error: charge.error ?? "Payment failed",
        next_attempt_at: retry?.toISOString() ?? null,
      })
      .eq("id", sub.id);
    await recordEvent(service, {
      orgId: sub.organization_id,
      subscriptionId: sub.id,
      kind: "payment_failed",
      plan: target.plan,
      interval: target.interval,
      amountUsd: price,
      note: charge.error ?? "Payment failed",
    });
    return { ok: false, error: charge.error };
  }

  // Anchored on the ORIGINAL start date so the billing day of month survives a
  // short February, and so a delayed sweep advances to the current period in one
  // step instead of billing every missed cycle.
  const period = advancePeriod(new Date(sub.started_at), target.interval, now);

  // Book the renewal BEFORE granting credits: the unique index on
  // (subscription_id, reference) for kind='renewed' is what makes a concurrent
  // second sweep fail here instead of granting a second month of credits.
  await recordEvent(service, {
    orgId: sub.organization_id,
    subscriptionId: sub.id,
    kind: "renewed",
    plan: target.plan,
    interval: target.interval,
    amountUsd: price,
    credits: planGrantCredits(plan, target.interval),
    // The period just paid for — stable across retries of the same renewal.
    reference: `period:${sub.current_period_end}`,
    note: `${plan.name} plan renewed (${target.interval})`,
  });

  const { error: advanceError } = await service
    .from("subscriptions")
    .update({
      plan: target.plan,
      interval: target.interval,
      price_usd: price,
      status: "active",
      current_period_start: period.start.toISOString(),
      current_period_end: period.end.toISOString(),
      pending_plan: null,
      pending_interval: null,
      failed_attempts: 0,
      last_payment_error: null,
      next_attempt_at: null,
    })
    .eq("id", sub.id)
    // Optimistic claim: only advance the period we read. A racing sweep that
    // already advanced it updates nothing.
    .eq("current_period_end", sub.current_period_end);
  if (advanceError) throw new Error(advanceError.message);

  const credits = planGrantCredits(plan, target.interval);
  await grantCredits(service, sub.organization_id, credits, "plan_grant", {
    note: `${plan.name} plan — renewal (${target.interval})`,
  });

  // Tenure credit accrues on the same cadence the Wallet page advertises it.
  await grantTenureBonus(service, sub.organization_id, plan.name);

  if (target.plan !== sub.plan || target.interval !== sub.interval) {
    await recordEvent(service, {
      orgId: sub.organization_id,
      subscriptionId: sub.id,
      kind: "downgrade_applied",
      plan: target.plan,
      interval: target.interval,
      note: `Scheduled switch to ${plan.name} applied`,
    });
  }

  await syncWalletPlan(service, sub.organization_id, {
    plan: target.plan,
    interval: target.interval,
  });

  return { ok: true, credits };
}

// Grant the tenure ("loyalty") bonus earned by continuous subscription. Kept
// here so it accrues on exactly the cadence the Wallet page shows it accruing.
async function grantTenureBonus(
  service: ServiceClient,
  orgId: string,
  planName: string,
): Promise<void> {
  const { data } = await service
    .from("wallets")
    .select("plan_started_at")
    .eq("organization_id", orgId)
    .maybeSingle();
  const months = tenureMonths((data as { plan_started_at?: string | null } | null)?.plan_started_at);
  const bonus = loyaltyBonus(months);
  if (bonus > 0) {
    await grantCredits(service, orgId, bonus, "loyalty", {
      note: `${planName} plan — tenure credit (month ${months})`,
    });
  }
}

/** Close a subscription for good and drop the org back to no plan. */
async function endSubscription(
  service: ServiceClient,
  sub: Subscription,
  reason: string,
  now: Date,
): Promise<void> {
  await service
    .from("subscriptions")
    .update({ status: "canceled", ended_at: now.toISOString() })
    .eq("id", sub.id);
  await syncWalletPlan(service, sub.organization_id, { plan: null, interval: null });
  await recordEvent(service, {
    orgId: sub.organization_id,
    subscriptionId: sub.id,
    kind: "ended",
    plan: sub.plan,
    interval: sub.interval,
    note: reason,
  });
}
