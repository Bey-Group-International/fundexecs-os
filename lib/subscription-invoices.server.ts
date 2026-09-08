// lib/subscription-invoices.server.ts
// Issuing, settling and applying subscription invoices.
//
// The native settlement path: a period is billed, the operator transfers the
// money, finance confirms it, and only then are the period's credits granted.
// "Only then" is the point — the old native rail granted a plan's value without
// collecting anything, which is fine in a demo and a giveaway in production.
//
// Marking an invoice paid moves real value, so every write here runs on the
// service role and none of it is reachable from the browser.
import { createServiceClient, createServerClient } from "@/lib/supabase/server";
import { grantCredits } from "@/lib/credits";
import {
  PLAN_BY_KEY,
  planGrantCredits,
  planPrice,
  type PlanInterval,
  type PlanKey,
} from "@/lib/billing";
import {
  dueDate,
  NET_TERMS_DAYS,
  type SettlementMethod,
  type SubscriptionInvoice,
} from "@/lib/subscription-invoices";

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface IssueInvoiceInput {
  orgId: string;
  /** Null for a first purchase — the subscription does not exist until it is paid. */
  subscriptionId: string | null;
  planKey: PlanKey;
  interval: PlanInterval;
  periodStart: Date;
  periodEnd: Date;
  /** Override the billed amount (a prorated upgrade bills the difference). */
  amountUsd?: number;
  /** Override the credits this period grants (prorated upgrades again). */
  credits?: number;
  termsDays?: number;
  note?: string;
}

export interface IssueResult {
  ok: boolean;
  invoice?: SubscriptionInvoice;
  error?: string;
  /** The period was already billed; this is the invoice that did it. */
  existing?: boolean;
}

/**
 * Bill a subscription period.
 *
 * Idempotent by (subscription, period): the unique index means a sweep that runs
 * twice re-finds the invoice rather than billing the operator again, and this
 * returns that invoice instead of an error.
 */
export async function issueInvoice(
  input: IssueInvoiceInput,
  client?: ServiceClient,
): Promise<IssueResult> {
  const service = client ?? createServiceClient();
  const plan = PLAN_BY_KEY[input.planKey];
  if (!plan) return { ok: false, error: "Unknown plan" };

  // Never issue while a bill is already open. This covers the period re-billed
  // by a repeated sweep AND the first purchase clicked twice — the latter has no
  // subscription id yet, so a period-keyed lookup alone would miss it.
  const existing = await openInvoiceForOrg(service, input.orgId);
  if (existing) return { ok: true, invoice: existing, existing: true };

  const now = new Date();
  const { data: numberRow, error: numberError } = await service.rpc(
    "next_subscription_invoice_number",
  );
  if (numberError) {
    console.error("[subscription-invoices] could not allocate a number:", numberError);
    return { ok: false, error: "Could not issue the invoice." };
  }

  const { data, error } = await service
    .from("subscription_invoices")
    .insert({
      organization_id: input.orgId,
      subscription_id: input.subscriptionId ?? null,
      number: numberRow as unknown as string,
      plan: input.planKey,
      interval: input.interval,
      period_start: input.periodStart.toISOString(),
      period_end: input.periodEnd.toISOString(),
      amount_usd: input.amountUsd ?? planPrice(plan, input.interval),
      credits: input.credits ?? planGrantCredits(plan, input.interval),
      status: "open",
      issued_at: now.toISOString(),
      due_at: dueDate(now, input.termsDays ?? NET_TERMS_DAYS).toISOString(),
      note: input.note ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    // A concurrent sweep won one of the unique indexes — its invoice is the
    // right answer, whether it beat us on the period or on the org's open bill.
    const raced =
      (await invoiceForPeriod(service, input.subscriptionId ?? null, input.periodStart)) ??
      (await openInvoiceForOrg(service, input.orgId));
    if (raced) return { ok: true, invoice: raced, existing: true };
    console.error("[subscription-invoices] issue failed:", error);
    return { ok: false, error: "Could not issue the invoice." };
  }
  return { ok: true, invoice: data as SubscriptionInvoice };
}

/** The organization's currently-open bill, if it has one. */
async function openInvoiceForOrg(
  service: ServiceClient,
  orgId: string,
): Promise<SubscriptionInvoice | null> {
  const { data } = await service
    .from("subscription_invoices")
    .select("*")
    .eq("organization_id", orgId)
    .eq("status", "open")
    .order("issued_at", { ascending: true })
    .limit(1);
  return ((data ?? [])[0] as SubscriptionInvoice | undefined) ?? null;
}

/**
 * An already-issued invoice for a specific period, in any state but void.
 *
 * Note the null handling: a first-purchase invoice has no subscription yet, and
 * `subscription_id = null` never matches in SQL — it has to be asked as IS NULL,
 * which is the difference between finding the existing bill and issuing a
 * second one.
 */
async function invoiceForPeriod(
  service: ServiceClient,
  subscriptionId: string | null,
  periodStart: Date,
): Promise<SubscriptionInvoice | null> {
  let query = service
    .from("subscription_invoices")
    .select("*")
    .eq("period_start", periodStart.toISOString())
    .neq("status", "void");
  query = subscriptionId
    ? query.eq("subscription_id", subscriptionId)
    : query.is("subscription_id", null);
  const { data } = await query.limit(1);
  return ((data ?? [])[0] as SubscriptionInvoice | undefined) ?? null;
}

/** The invoice a subscription is currently waiting on, if any. */
export async function outstandingInvoice(
  orgId: string,
  client?: ServiceClient,
): Promise<SubscriptionInvoice | null> {
  const service = client ?? createServiceClient();
  const { data } = await service
    .from("subscription_invoices")
    .select("*")
    .eq("organization_id", orgId)
    .eq("status", "open")
    .order("issued_at", { ascending: true })
    .limit(1);
  return ((data ?? [])[0] as SubscriptionInvoice | undefined) ?? null;
}

/** An org's subscription bills, newest first — reader-scoped for the Wallet. */
export async function listSubscriptionInvoices(
  orgId: string,
  limit = 12,
): Promise<SubscriptionInvoice[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("subscription_invoices")
    .select("*")
    .eq("organization_id", orgId)
    .order("issued_at", { ascending: false })
    .limit(limit);
  return (data as SubscriptionInvoice[] | null) ?? [];
}

export interface SettleResult {
  ok: boolean;
  error?: string;
  invoice?: SubscriptionInvoice;
  /** Credits granted by applying the paid period, when it was applied here. */
  credits?: number;
}

/**
 * Record that an invoice has been settled.
 *
 * Confirming a transfer is a human act — finance sees the money arrive and says
 * so — which is why `reference` matters: it is the audit trail tying a period's
 * credits to a specific payment. The compare-and-set on `status = 'open'` means
 * two people confirming the same wire cannot pay the invoice twice.
 */
export async function markInvoiceSettled(
  invoiceId: string,
  opts: { via: SettlementMethod; reference?: string | null; note?: string },
  client?: ServiceClient,
): Promise<SettleResult> {
  const service = client ?? createServiceClient();
  const now = new Date().toISOString();

  const { data, error } = await service
    .from("subscription_invoices")
    .update({
      status: "paid",
      paid_at: now,
      paid_via: opts.via,
      payment_reference: opts.reference ?? null,
      ...(opts.note ? { note: opts.note } : {}),
    })
    .eq("id", invoiceId)
    // Only an OPEN invoice can be settled: this is what makes a double
    // confirmation a no-op rather than a second grant.
    .eq("status", "open")
    .select("*");

  if (error) {
    console.error("[subscription-invoices] settle failed:", error);
    return { ok: false, error: "Could not record the payment." };
  }
  const invoice = (data ?? [])[0] as SubscriptionInvoice | undefined;
  if (!invoice) {
    // Already settled (or void). Not an error — just nothing more to do.
    const { data: current } = await service
      .from("subscription_invoices")
      .select("*")
      .eq("id", invoiceId)
      .maybeSingle();
    return { ok: true, invoice: (current as SubscriptionInvoice | null) ?? undefined };
  }

  // Deliberately NOT applied here. Turning a settled invoice into value means
  // knowing whether a subscription has to be started or merely advanced, which
  // is the subscriptions layer's business — and doing it there keeps this module
  // free of a circular dependency on it. The sweep and the confirm action both
  // call applySettledInvoices immediately after.
  return { ok: true, invoice };
}

/**
 * Claim a settled invoice's period and grant its credits.
 *
 * `applied_at` is claimed with a compare-and-set BEFORE any credits are granted,
 * so a re-run — a retried sweep, a double settle — finds the claim taken and
 * grants nothing. Value is only ever handed over once per invoice.
 *
 * Callers own what the period MEANS (starting a plan, advancing one); this only
 * makes sure it is handed over exactly once.
 */
export async function applyPaidInvoice(
  invoice: SubscriptionInvoice,
  client?: ServiceClient,
): Promise<{ applied: boolean; credits?: number }> {
  const service = client ?? createServiceClient();
  if (invoice.status !== "paid" || invoice.applied_at) return { applied: false };

  const { data: claimed } = await service
    .from("subscription_invoices")
    .update({ applied_at: new Date().toISOString() })
    .eq("id", invoice.id)
    .is("applied_at", null)
    .select("id");
  if (!claimed || claimed.length === 0) return { applied: false };

  if (invoice.credits > 0) {
    const plan = PLAN_BY_KEY[invoice.plan as PlanKey];
    await grantCredits(service, invoice.organization_id, invoice.credits, "plan_grant", {
      note: `${plan?.name ?? invoice.plan} plan — ${invoice.number}`,
    });
  }
  return { applied: true, credits: invoice.credits };
}

/** Settled invoices whose period has not been handed over yet. */
export async function unappliedSettledInvoices(
  service: ServiceClient,
  limit = 50,
): Promise<SubscriptionInvoice[]> {
  const { data } = await service
    .from("subscription_invoices")
    .select("*")
    .eq("status", "paid")
    .is("applied_at", null)
    .order("paid_at", { ascending: true })
    .limit(limit);
  return (data as SubscriptionInvoice[] | null) ?? [];
}

/** Attach an invoice to the subscription its payment brought into existence. */
export async function linkInvoiceToSubscription(
  invoiceId: string,
  subscriptionId: string,
  client?: ServiceClient,
): Promise<void> {
  const service = client ?? createServiceClient();
  await service
    .from("subscription_invoices")
    .update({ subscription_id: subscriptionId })
    .eq("id", invoiceId)
    .is("subscription_id", null);
}

/** Withdraw an invoice that should no longer be paid (plan changed, cancelled). */
export async function voidInvoice(
  invoiceId: string,
  note: string,
  client?: ServiceClient,
): Promise<void> {
  const service = client ?? createServiceClient();
  await service
    .from("subscription_invoices")
    .update({ status: "void", note })
    .eq("id", invoiceId)
    .eq("status", "open");
}

/** Close out an invoice that was never settled, when the subscription ends. */
export async function writeOffInvoice(
  invoiceId: string,
  note: string,
  client?: ServiceClient,
): Promise<void> {
  const service = client ?? createServiceClient();
  await service
    .from("subscription_invoices")
    .update({ status: "written_off", note })
    .eq("id", invoiceId)
    .eq("status", "open");
}
