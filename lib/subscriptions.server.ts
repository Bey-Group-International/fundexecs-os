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
  issueInvoice,
  applyPaidInvoice,
  markInvoiceSettled,
  writeOffInvoice,
  unappliedSettledInvoices,
  linkInvoiceToSubscription,
} from "@/lib/subscription-invoices.server";
import {
  isOverdue,
  remittanceConfigured,
  type SubscriptionInvoice,
} from "@/lib/subscription-invoices";
import {
  debitInvoice,
  pollSettlement,
  inFlightDebits,
  uncollectedInvoices,
  settlementCapability,
  settlementContext,
} from "@/lib/native-payments.server";
import { chosenRoute, overdueRoute } from "@/lib/native-payments";
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
  /** The operation closed the subscription (its last charge attempt failed). */
  ended?: boolean;
  /** The period was billed by invoice and is awaiting settlement. */
  invoiced?: boolean;
  /** The invoice the period is waiting on, when one was issued or found. */
  invoice?: SubscriptionInvoice;
  /**
   * A bank debit is already in flight for that invoice, so the money collects
   * itself. False means the invoice is waiting on the operator to send it.
   */
  collecting?: boolean;
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
  /**
   * Don't grant the first period's credits — the caller has already handed them
   * over (a settled invoice claims and grants its own period).
   */
  skipInitialGrant?: boolean;
  /**
   * Start the plan and hand over its credits NOW, with the invoice outstanding,
   * instead of waiting for the transfer to clear.
   *
   * This is a deliberate extension of credit and the only thing that makes a
   * one-click unlock possible when settlement takes days (lib/paywall.server).
   * The exposure is one period; dunning closes a subscription that is never paid
   * for, and an org with an unpaid period behind it is refused a second one.
   */
  grantBeforeSettlement?: boolean;
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

  // Native first purchase: bill the period and wait for the transfer. No
  // subscription is created yet — a plan that exists before anyone has paid for
  // it is precisely the giveaway this rail used to be. The invoice carries the
  // period, and settling it is what starts the subscription (see
  // applySettledInvoices).
  //
  // `grantBeforeSettlement` is the deliberate exception: the plan starts and its
  // credits are handed over now, with the invoice outstanding. Only the paywall
  // sets it, and only for an org entitled to a period on credit.
  if (!input.alreadyPaid && !input.grantBeforeSettlement && remittanceConfigured()) {
    const issued = await issueInvoice(
      {
        orgId: input.orgId,
        // No subscription to attach to yet; payment creates it.
        subscriptionId: null,
        planKey: input.planKey,
        interval: input.interval,
        periodStart: now,
        periodEnd: periodEnd(now, input.interval),
        amountUsd: price,
        credits: planGrantCredits(plan, input.interval),
        note: `${plan.name} plan — first period`,
      },
      service,
    );
    if (!issued.ok || !issued.invoice) {
      return { ok: false, error: issued.error ?? "Could not issue an invoice." };
    }
    // Re-finding the bill a second click already raised is not a new issuance.
    if (issued.existing) {
      return { ok: false, invoiced: true, invoice: issued.invoice };
    }
    await recordEvent(service, {
      orgId: input.orgId,
      subscriptionId: null,
      kind: "invoice_issued",
      plan: input.planKey,
      interval: input.interval,
      amountUsd: price,
      reference: issued.invoice.number,
      note: `${issued.invoice.number} issued — plan starts when payment clears`,
    });
    return { ok: false, invoiced: true, invoice: issued.invoice };
  }

  // Checkout collected the first period; the rail only runs when it didn't
  // (the native in-app path, or a plan started server-side).
  let reference = input.reference ?? null;
  // A commit-first start is the operator saying "bill me" — the period is handed
  // over now and the invoice chases the money. Running the card rail here asked
  // for a saved card and failed the whole commit without one, which is exactly
  // the friction the one-click unlock exists to remove.
  if (!input.alreadyPaid && !input.grantBeforeSettlement) {
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
  if (!input.skipInitialGrant) {
    await grantCredits(service, input.orgId, credits, "plan_grant", {
      note: input.note ?? `${plan.name} plan (${input.interval})`,
    });
  }
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

  // A commit-first start owes for the period it just handed over. Issue the
  // invoice now so the money is actually chased — a period granted with no bill
  // behind it is a gift, not a subscription.
  let commitInvoice: SubscriptionInvoice | undefined;
  let collecting = false;
  // Not gated on remittanceConfigured(): the bill exists because a period was
  // handed over, not because we can print wire instructions. Whether an operator
  // can be shown somewhere to send a transfer is a display question, and the
  // debit below does not need it at all.
  if (input.grantBeforeSettlement && !input.alreadyPaid) {
    const issued = await issueInvoice(
      {
        orgId: input.orgId,
        subscriptionId: sub.id,
        planKey: input.planKey,
        interval: input.interval,
        periodStart: now,
        periodEnd: periodEnd(now, input.interval),
        amountUsd: price,
        // The credits were granted above; the invoice must not grant them again
        // when it settles.
        credits: 0,
        note: `${plan.name} plan — first period (access started immediately)`,
      },
      service,
    );
    if (issued.ok && issued.invoice) {
      commitInvoice = issued.invoice;
      await recordEvent(service, {
        orgId: input.orgId,
        subscriptionId: sub.id,
        kind: "invoice_issued",
        plan: input.planKey,
        interval: input.interval,
        amountUsd: price,
        reference: issued.invoice.number,
        note: `${issued.invoice.number} issued — access started before settlement`,
      });
      // Collect it now if we can. An org that has linked a bank account gets
      // debited the moment it commits — no waiting for terms to run out, and
      // nobody watching for an inbound transfer. Where there is no account to
      // pull from, fall back to chasing it when it comes due.
      let chaseAt: string | null = issued.invoice.due_at;
      const { cap, preference } = await settlementContext(service, input.orgId);
      if (chosenRoute(cap, preference) === "ach_debit") {
        const debit = await debitInvoice(issued.invoice, service);
        if (debit.ok && debit.processing) {
          // In flight: collectNativePayments owns it from here, so the renewal
          // sweep must not also reach for it.
          chaseAt = null;
          collecting = true;
          await recordEvent(service, {
            orgId: input.orgId,
            subscriptionId: sub.id,
            kind: "debit_submitted",
            plan: input.planKey,
            interval: input.interval,
            amountUsd: price,
            reference: debit.intent ?? issued.invoice.number,
            note: `${issued.invoice.number} — bank debit submitted on commit`,
          });
        }
      }
      await service
        .from("subscriptions")
        .update({ next_attempt_at: chaseAt })
        .eq("id", sub.id);
    }
  }

  // Settle any pending referral chain now that the org is a subscriber.
  try {
    await awardReferralOnSubscription(input.orgId, service);
  } catch (err) {
    console.error("[referral] awardReferralOnSubscription failed:", err);
  }

  return { ok: true, subscription: sub, credits, invoice: commitInvoice, collecting };
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

/**
 * Hand over every settled invoice whose period has not been applied yet.
 *
 * This is the one place a payment becomes value. An invoice with no
 * subscription is a first purchase — settling it starts the plan; one attached
 * to a subscription is a renewal the sweep will advance. `applyPaidInvoice`
 * claims each invoice before granting, so running this twice grants nothing
 * twice.
 */
export async function applySettledInvoices(
  service: ServiceClient,
  now: Date = new Date(),
): Promise<{ applied: number; started: number; credits: number }> {
  const stats = { applied: 0, started: 0, credits: 0 };
  for (const invoice of await unappliedSettledInvoices(service)) {
    try {
      if (invoice.subscription_id) {
        // A renewal. The period is advanced by the sweep (so the advance and the
        // grant stay in lockstep), but the subscription is asleep until the
        // invoice's due date — that is when it was told to look again. Clear the
        // wake-up so the very next sweep sees it: an operator who pays early
        // must not wait until the day the bill was due to get what they bought.
        await service
          .from("subscriptions")
          .update({ next_attempt_at: null })
          .eq("id", invoice.subscription_id);
        continue;
      }

      // A first purchase. Claim the invoice first: if the claim is lost, another
      // worker is already starting this subscription.
      const claim = await applyPaidInvoice(invoice, service);
      if (!claim.applied) continue;

      const started = await startSubscription(
        {
          orgId: invoice.organization_id,
          planKey: invoice.plan as PlanKey,
          interval: invoice.interval as PlanInterval,
          // The invoice is the payment, and its credits were just granted by the
          // claim above — so the subscription must not charge or grant again.
          alreadyPaid: true,
          skipInitialGrant: true,
          reference: invoice.payment_reference ?? invoice.number,
          note: `${invoice.plan} plan — started by ${invoice.number}`,
        },
        service,
      );
      if (started.ok && started.subscription) {
        await linkInvoiceToSubscription(invoice.id, started.subscription.id, service);
        stats.started += 1;
      }
      stats.applied += 1;
      stats.credits += claim.credits ?? 0;
    } catch (err) {
      console.error("[subscriptions] applying a settled invoice failed", invoice.id, err);
    }
  }
  void now;
  return stats;
}

// Give an in-flight debit the time ACH actually takes before looking again.
function expectedClearing(now: Date): string {
  return new Date(now.getTime() + 5 * 86_400_000).toISOString();
}

/**
 * Resolve every bank debit that is in flight.
 *
 * Runs before the renewal sweep: a debit that cleared since the last pass should
 * settle its invoice in the same run, so the operator gets the period they paid
 * for now rather than an hour later. A bounce puts the invoice back to open and
 * wakes the subscription, so the overdue path can reach for the card.
 */
export async function collectNativePayments(
  service: ServiceClient,
  now: Date = new Date(),
): Promise<{ submitted: number; polled: number; settled: number; bounced: number }> {
  const stats = { submitted: 0, polled: 0, settled: 0, bounced: 0 };

  // Start collecting anything nobody has reached for yet. This sweep used to
  // only poll debits that were already running, so an open invoice with no debit
  // behind it waited for the renewal path to notice it — for a first period,
  // that is the end of the period. An org with a linked account is now debited
  // on the next sweep after the invoice is raised, whenever it was raised and
  // whatever raised it.
  for (const invoice of await uncollectedInvoices(service)) {
    try {
      const { cap, preference } = await settlementContext(service, invoice.organization_id);
      // Only the pull rail self-collects. A transfer needs the operator to send
      // the money and a card is the fallback the dunning ladder reaches for; nothing
      // here should quietly charge a card that no one has been asked about — an
      // org that chose the card rail is charged by the dunning path, in the open.
      if (chosenRoute(cap, preference) !== "ach_debit") continue;
      const debit = await debitInvoice(invoice, service);
      if (debit.ok && debit.processing) {
        stats.submitted += 1;
        await recordEvent(service, {
          orgId: invoice.organization_id,
          subscriptionId: invoice.subscription_id,
          kind: "debit_submitted",
          plan: invoice.plan,
          interval: invoice.interval,
          amountUsd: Number(invoice.amount_usd),
          reference: debit.intent ?? invoice.number,
          note: `${invoice.number} — bank debit submitted`,
        });
        if (invoice.subscription_id) {
          // In flight now; the poll below owns the outcome, so the renewal sweep
          // must not reach for the same invoice on this pass.
          await service
            .from("subscriptions")
            .update({ next_attempt_at: null })
            .eq("id", invoice.subscription_id);
        }
      }
    } catch (err) {
      console.error("[subscriptions] submitting a debit failed", invoice.id, err);
    }
  }

  for (const invoice of await inFlightDebits(service)) {
    try {
      stats.polled += 1;
      const result = await pollSettlement(invoice, service);
      if (result.settled) {
        stats.settled += 1;
        if (invoice.subscription_id) {
          // Wake it so the renewal sweep hands the period over on this pass.
          await service
            .from("subscriptions")
            .update({ next_attempt_at: null })
            .eq("id", invoice.subscription_id);
        }
      } else if (result.failed) {
        stats.bounced += 1;
        await recordEvent(service, {
          orgId: invoice.organization_id,
          subscriptionId: invoice.subscription_id,
          kind: "debit_returned",
          plan: invoice.plan,
          interval: invoice.interval,
          amountUsd: Number(invoice.amount_usd),
          note: invoice.settlement_failure ?? "The bank returned the payment",
        });
        if (invoice.subscription_id) {
          await service
            .from("subscriptions")
            .update({ next_attempt_at: null })
            .eq("id", invoice.subscription_id);
        }
      }
    } catch (err) {
      console.error("[subscriptions] polling a debit failed", invoice.id, err);
    }
  }
  void now;
  return stats;
}

export interface RenewalStats {
  due: number;
  renewed: number;
  failed: number;
  ended: number;
  credits: number;
  /** Periods billed by invoice this sweep, now awaiting settlement. */
  invoiced: number;
  /** Subscriptions waiting on an invoice that is issued but not yet due. */
  awaiting: number;
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
  const stats: RenewalStats = {
    due: 0, renewed: 0, failed: 0, ended: 0, credits: 0, invoiced: 0, awaiting: 0,
  };

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
      // A subscription with a date in the future is waiting on something — a
      // scheduled dunning retry, or an invoice inside its payment terms — and
      // is left alone until that date arrives rather than being reprocessed
      // every hour.
      if (sub.next_attempt_at && new Date(sub.next_attempt_at).getTime() > now.getTime()) {
        stats.due -= 1;
        stats.awaiting += 1;
        continue;
      }

      // A cancellation is the operator's own instruction, so it closes without
      // a charge. A past_due row is NOT closed here: it gets the attempt its
      // retry date promised. Short-circuiting that attempt made the whole
      // dunning window unwinnable — a card added during it was never tried, so
      // the operator lost the plan having done exactly what we asked.
      if (sub.cancel_at_period_end) {
        await endSubscription(service, sub, "Cancelled by the operator", now);
        stats.ended += 1;
        continue;
      }

      const result = await renewOne(service, sub, now);
      if (result.ok) {
        stats.renewed += 1;
        stats.credits += result.credits ?? 0;
      } else if (result.invoiced) {
        // Billed and waiting on the transfer — neither renewed nor failed.
        stats.invoiced += 1;
        stats.awaiting += 1;
      } else if (result.ended) {
        // The final attempt failed and closed the subscription.
        stats.ended += 1;
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
// Renew a single subscription. Which path settles the period is decided here:
// an invoice when this deployment can be paid by transfer, a card charge when it
// cannot — and a card charge as the fallback when an invoice goes unpaid.
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
  // Anchored on the ORIGINAL start date so the billing day of month survives a
  // short February, and so a delayed sweep advances to the current period in one
  // step instead of billing every missed cycle.
  const period = advancePeriod(new Date(sub.started_at), target.interval, now);

  // Native settlement: bill the period and wait for the money, rather than
  // reaching for a card. Only a deployment with no remittance details — nowhere
  // for an operator to send a transfer — goes straight to the processor.
  if (remittanceConfigured()) {
    return settleByInvoice(service, sub, { target, plan, price, period }, now);
  }
  return chargeAndApply(service, sub, { target, plan, price, period }, now, null);
}

interface PeriodTerms {
  target: { plan: PlanKey; interval: PlanInterval };
  plan: (typeof PLAN_BY_KEY)[PlanKey];
  price: number;
  period: { start: Date; end: Date };
}

/**
 * The native path: bill the period, then wait.
 *
 * Access continues while the invoice is inside its terms — the operator has been
 * billed, not cut off, and a wire takes days. Only once it is overdue does the
 * card fallback run, and only if that fails does dunning start.
 */
async function settleByInvoice(
  service: ServiceClient,
  sub: Subscription,
  terms: PeriodTerms,
  now: Date,
): Promise<LifecycleResult> {
  const { target, plan, price, period } = terms;

  const issued = await issueInvoice(
    {
      orgId: sub.organization_id,
      subscriptionId: sub.id,
      planKey: target.plan,
      interval: target.interval,
      periodStart: period.start,
      periodEnd: period.end,
      amountUsd: price,
      credits: planGrantCredits(plan, target.interval),
      note: `${plan.name} plan — ${target.interval} period`,
    },
    service,
  );
  if (!issued.ok || !issued.invoice) {
    // Could not bill at all. Leave the period where it is so the next sweep
    // retries; never grant a period nobody has been asked to pay for.
    return { ok: false, error: issued.error ?? "Could not issue an invoice." };
  }
  const invoice = issued.invoice;

  // Settled since the last sweep — hand over the period the operator paid for.
  if (invoice.status === "paid") {
    const applied = await applyPaidInvoice(invoice, service);
    return advanceAfterSettlement(service, sub, terms, now, {
      credits: applied.credits ?? invoice.credits,
      grantCreditsHere: false,
      reference: invoice.payment_reference ?? invoice.number,
      note: `${plan.name} plan — settled by ${invoice.paid_via ?? "transfer"} (${invoice.number})`,
    });
  }

  // A debit already in flight: the money is coming, so wait for it. The poll
  // that resolves it runs before this sweep (see collectNativePayments).
  if (invoice.status === "processing") {
    return { ok: false, invoiced: true, invoice };
  }

  // Still within terms. Collect it rather than only printing instructions: an
  // org with a linked account gets debited, which is the whole point of the
  // native rail — nobody has to remember to send anything.
  if (!isOverdue(invoice, now)) {
    const { cap, preference } = await settlementContext(service, sub.organization_id);
    if (chosenRoute(cap, preference) === "ach_debit" && !invoice.settlement_intent) {
      const debit = await debitInvoice(invoice, service);
      if (debit.ok && debit.processing) {
        await recordEvent(service, {
          orgId: sub.organization_id,
          subscriptionId: sub.id,
          kind: "debit_submitted",
          plan: target.plan,
          interval: target.interval,
          amountUsd: price,
          reference: debit.intent ?? null,
          note: `${invoice.number} — collecting from the linked account`,
        });
        // Look again once it should have cleared, not every hour until then.
        await service
          .from("subscriptions")
          .update({ next_attempt_at: invoice.due_at })
          .eq("id", sub.id);
        return { ok: false, invoiced: true, invoice };
      }
      // Could not submit — fall through to the wire instructions below, which is
      // still a native way to pay.
    }

    if (!issued.existing) {
      await recordEvent(service, {
        orgId: sub.organization_id,
        subscriptionId: sub.id,
        kind: "invoice_issued",
        plan: target.plan,
        interval: target.interval,
        amountUsd: price,
        reference: invoice.number,
        note: `${invoice.number} issued — due ${invoice.due_at.slice(0, 10)}`,
      });
    }
    // Come back when it falls due, not every hour until then.
    await service
      .from("subscriptions")
      .update({ next_attempt_at: invoice.due_at })
      .eq("id", sub.id);
    return { ok: false, invoiced: true, invoice };
  }

  // Overdue. Which rail is left depends on what the org has and on whether a
  // debit has already bounced — asking a bank twice for money it refused just
  // earns another return fee.
  const cap = await settlementCapability(service, sub.organization_id);
  const route = overdueRoute(cap, invoice);
  if (route === "ach_debit" && !invoice.settlement_intent) {
    const debit = await debitInvoice(invoice, service);
    if (debit.ok && debit.processing) {
      await service
        .from("subscriptions")
        .update({ next_attempt_at: expectedClearing(now) })
        .eq("id", sub.id);
      return { ok: false, invoiced: true, invoice };
    }
  }
  // This is where the processor earns its keep.
  return chargeAndApply(service, sub, terms, now, invoice);
}

/**
 * Charge a card for the period and, if it lands, hand the period over.
 *
 * `invoice` is set when this is the fallback for an unpaid transfer: settling it
 * by card closes the bill out honestly rather than leaving it open forever.
 */
async function chargeAndApply(
  service: ServiceClient,
  sub: Subscription,
  terms: PeriodTerms,
  now: Date,
  invoice: SubscriptionInvoice | null,
): Promise<LifecycleResult> {
  const { target, plan, price } = terms;

  const charge = await chargeSubscription({
    orgId: sub.organization_id,
    amountUsd: invoice ? invoice.amount_usd : price,
    description: `FundExecs OS — ${plan.name} plan renewal (${target.interval})`,
    customerId: sub.processor_customer_id,
    paymentMethodId: await paymentMethodFor(service, sub.organization_id),
    // Keyed on the period being paid for, so a re-run of the sweep settles the
    // same charge rather than a second one.
    idempotencyKey: `renew:${sub.id}:${sub.current_period_end}`,
  });

  if (!charge.ok) {
    return dun(service, sub, terms, now, charge.error, invoice);
  }

  if (invoice) {
    await markInvoiceSettled(
      invoice.id,
      { via: "card", reference: charge.reference, note: "Settled by card after the transfer went unpaid" },
      service,
    );
    // Recording the payment does not hand the period over — applying the invoice
    // does, and it claims `applied_at` first so the period can only ever be
    // granted once however it was paid for.
    const claimed = await applyPaidInvoice(
      { ...invoice, status: "paid", applied_at: null },
      service,
    );
    return advanceAfterSettlement(service, sub, terms, now, {
      credits: claimed.credits ?? invoice.credits,
      // applyPaidInvoice granted them; granting again here would double the period.
      grantCreditsHere: false,
      reference: charge.reference ?? null,
      note: `${plan.name} plan — ${invoice.number} settled by card`,
    });
  }

  return advanceAfterSettlement(service, sub, terms, now, {
    credits: planGrantCredits(plan, target.interval),
    grantCreditsHere: true,
    reference: charge.reference ?? null,
    note: `${plan.name} plan renewed (${target.interval})`,
  });
}

/** A failed charge: record it, schedule the retry, or close when they run out. */
async function dun(
  service: ServiceClient,
  sub: Subscription,
  terms: PeriodTerms,
  now: Date,
  error: string | undefined,
  invoice: SubscriptionInvoice | null,
): Promise<LifecycleResult> {
  const { target, price } = terms;
  const attempts = sub.failed_attempts + 1;
  const retry = nextAttemptAt(attempts, now);

  await recordEvent(service, {
    orgId: sub.organization_id,
    subscriptionId: sub.id,
    kind: "payment_failed",
    plan: target.plan,
    interval: target.interval,
    amountUsd: price,
    note: error ?? "Payment failed",
  });

  // The retry budget is spent: this failure WAS the last chance, so close now
  // rather than leaving the row past_due with a retry date nothing will honor.
  if (!retry) {
    if (invoice) {
      await writeOffInvoice(invoice.id, "Subscription closed with this period unpaid", service);
    }
    await endSubscription(
      service,
      { ...sub, failed_attempts: attempts },
      "Payment could not be collected",
      now,
    );
    return { ok: false, error, ended: true };
  }

  await service
    .from("subscriptions")
    .update({
      status: "past_due",
      failed_attempts: attempts,
      last_payment_error: error ?? "Payment failed",
      next_attempt_at: retry.toISOString(),
    })
    .eq("id", sub.id);
  return { ok: false, error };
}

/**
 * The period has been paid for: book it, advance the subscription, and grant.
 *
 * The renewal event is recorded BEFORE the grant because the unique index on
 * (subscription_id, reference) for kind='renewed' is what makes a concurrent
 * second sweep fail here instead of handing out a second period of credits.
 */
async function advanceAfterSettlement(
  service: ServiceClient,
  sub: Subscription,
  terms: PeriodTerms,
  now: Date,
  settlement: {
    credits: number;
    /** False when the credits were already granted by applying an invoice. */
    grantCreditsHere: boolean;
    reference: string | null;
    note: string;
  },
): Promise<LifecycleResult> {
  const { target, plan, price, period } = terms;

  await recordEvent(service, {
    orgId: sub.organization_id,
    subscriptionId: sub.id,
    kind: "renewed",
    plan: target.plan,
    interval: target.interval,
    amountUsd: price,
    credits: settlement.credits,
    // The period just paid for — stable across retries of the same renewal.
    reference: `period:${sub.current_period_end}`,
    note: settlement.note,
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

  if (settlement.grantCreditsHere && settlement.credits > 0) {
    await grantCredits(service, sub.organization_id, settlement.credits, "plan_grant", {
      note: settlement.note,
    });
  }

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

  return { ok: true, credits: settlement.credits };
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
