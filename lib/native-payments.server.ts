// lib/native-payments.server.ts
// Collecting a subscription invoice from the operator's own bank account.
//
// This is the machinery that removes the human from native settlement: instead
// of an operator remembering to send a wire and finance watching for it to
// land, the invoice debits the account they already linked.
//
// ACH is the whole design constraint. A debit is submitted, and days later it
// clears — or bounces, with a return code, after we may already have believed
// it. So submission moves an invoice to `processing` and NOTHING is granted;
// only a confirmed clearing marks it paid, which is what releases the period.
// Getting this wrong means handing over a period against money that comes back.
import { createServiceClient } from "@/lib/supabase/server";
import { getStripe, stripeConfigured } from "@/lib/stripe";
import type { SubscriptionInvoice } from "@/lib/subscription-invoices";
import {
  failureMessage,
  isPermanentFailure,
  type PayableRoute,
  type SettlementCapability,
} from "@/lib/native-payments";
import { remittanceConfigured } from "@/lib/subscription-invoices";

type ServiceClient = ReturnType<typeof createServiceClient>;

/** The active bank account an org can be debited from, if it has one. */
export async function debitableAccount(
  service: ServiceClient,
  orgId: string,
): Promise<{ id: string; paymentMethodId: string; last4: string | null } | null> {
  const { data } = await service
    .from("linked_accounts")
    .select("id, stripe_payment_method_id, last4, status")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .not("stripe_payment_method_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0] as
    | { id: string; stripe_payment_method_id: string | null; last4: string | null }
    | undefined;
  if (!row?.stripe_payment_method_id) return null;
  return { id: row.id, paymentMethodId: row.stripe_payment_method_id, last4: row.last4 };
}

/**
 * What this org can be collected from, and how it asked to be.
 *
 * Both in one read: every caller that needs the capability also needs the
 * preference (they are the two arguments to chosenRoute), and issuing two
 * queries for one decision is how a sweep over many invoices turns into twice
 * the round trips.
 */
export async function settlementContext(
  service: ServiceClient,
  orgId: string,
): Promise<{ cap: SettlementCapability; preference: PayableRoute | null }> {
  const [account, wallet] = await Promise.all([
    debitableAccount(service, orgId),
    service
      .from("wallets")
      .select("stripe_payment_method_id, preferred_route")
      .eq("organization_id", orgId)
      .maybeSingle(),
  ]);
  const walletRow = wallet.data as {
    stripe_payment_method_id?: string | null;
    preferred_route?: string | null;
  } | null;
  const savedCard = walletRow?.stripe_payment_method_id;
  const stored = walletRow?.preferred_route;
  return {
    cap: {
      hasLinkedAccount: Boolean(account) && stripeConfigured(),
      hasRemittance: remittanceConfigured(),
      // A card is only a route if there is both a card and a processor to run it.
      hasCard: Boolean(savedCard) && stripeConfigured(),
    },
    // Anything unrecognised (an older value, a hand-edited row) reads as "no
    // preference" rather than throwing: the fallback is always safe.
    preference:
      stored === "ach_debit" || stored === "card" || stored === "transfer" ? stored : null,
  };
}

/** What this org can actually be collected from — the input to route selection. */
export async function settlementCapability(
  service: ServiceClient,
  orgId: string,
): Promise<SettlementCapability> {
  return (await settlementContext(service, orgId)).cap;
}

export interface DebitResult {
  ok: boolean;
  /** The debit is submitted and clearing — not collected yet. */
  processing?: boolean;
  intent?: string;
  error?: string;
  /** The account will never work; stop trying this rail. */
  permanent?: boolean;
}

/**
 * Submit a bank debit for an invoice.
 *
 * Returns `processing`, never `paid`: the money has been asked for, not
 * received. The PaymentIntent id is written to the invoice before we care about
 * the outcome, so a sweep that dies mid-flight re-reads the debit it already
 * submitted instead of pulling the amount a second time.
 */
export async function debitInvoice(
  invoice: SubscriptionInvoice,
  client?: ServiceClient,
): Promise<DebitResult> {
  const service = client ?? createServiceClient();

  // Already submitted — never debit an invoice twice.
  if (invoice.settlement_intent) {
    return { ok: true, processing: true, intent: invoice.settlement_intent };
  }
  if (!stripeConfigured()) return { ok: false, error: "No bank rail configured." };

  const account = await debitableAccount(service, invoice.organization_id);
  if (!account) return { ok: false, error: "No linked bank account to collect from." };

  const { data: wallet } = await service
    .from("wallets")
    .select("stripe_customer_id")
    .eq("organization_id", invoice.organization_id)
    .maybeSingle();
  const customerId = (wallet as { stripe_customer_id?: string | null } | null)?.stripe_customer_id;
  if (!customerId) return { ok: false, error: "No billing account to collect against." };

  try {
    const intent = await getStripe().paymentIntents.create(
      {
        amount: Math.round(Number(invoice.amount_usd) * 100),
        currency: "usd",
        customer: customerId,
        payment_method: account.paymentMethodId,
        payment_method_types: ["us_bank_account"],
        confirm: true,
        // Nobody is present: this is a scheduled collection against an account
        // the operator authorised when they linked it.
        off_session: true,
        description: `FundExecs OS — invoice ${invoice.number}`,
        metadata: {
          org_id: invoice.organization_id,
          subscription_invoice_id: invoice.id,
          invoice_number: invoice.number,
        },
      },
      // Keyed on the invoice, so a retried sweep re-reads this debit rather than
      // creating a second one.
      { idempotencyKey: `sub-invoice-debit:${invoice.id}` },
    );

    await service
      .from("subscription_invoices")
      .update({
        status: "processing",
        settlement_intent: intent.id,
        settlement_started_at: new Date().toISOString(),
        settlement_failure: null,
        settlement_attempts: (invoice.settlement_attempts ?? 0) + 1,
        paid_via: null,
      })
      .eq("id", invoice.id)
      // Only an open invoice can be put in flight.
      .eq("status", "open");

    return { ok: true, processing: true, intent: intent.id };
  } catch (err) {
    const e = err as { code?: string; decline_code?: string };
    const code = e?.decline_code ?? e?.code ?? null;
    console.error("[native-payments] debit failed:", code ?? "", err);
    const message = failureMessage(code);
    await service
      .from("subscription_invoices")
      .update({
        settlement_failure: message,
        settlement_attempts: (invoice.settlement_attempts ?? 0) + 1,
      })
      .eq("id", invoice.id);
    return { ok: false, error: message, permanent: isPermanentFailure(code) };
  }
}

export interface PollResult {
  /** The debit cleared; the invoice is now paid. */
  settled: boolean;
  /** It bounced; the invoice is open again with the reason recorded. */
  failed: boolean;
  /** Still clearing. */
  pending: boolean;
  reference?: string;
}

/**
 * Ask the bank rail what became of an in-flight debit, and record it.
 *
 * This is the only thing that turns a submitted debit into a settled invoice.
 * A bounce puts the invoice back to `open` — the period is still owed, and the
 * ordinary overdue path takes it from there.
 */
export async function pollSettlement(
  invoice: SubscriptionInvoice,
  client?: ServiceClient,
): Promise<PollResult> {
  const service = client ?? createServiceClient();
  if (!invoice.settlement_intent || !stripeConfigured()) {
    return { settled: false, failed: false, pending: true };
  }

  try {
    const intent = await getStripe().paymentIntents.retrieve(invoice.settlement_intent);

    if (intent.status === "succeeded") {
      await service
        .from("subscription_invoices")
        .update({
          status: "paid",
          paid_at: new Date().toISOString(),
          paid_via: "ach_debit",
          payment_reference: intent.id,
          settlement_failure: null,
        })
        .eq("id", invoice.id)
        .eq("status", "processing");
      return { settled: true, failed: false, pending: false, reference: intent.id };
    }

    if (
      intent.status === "requires_payment_method" ||
      intent.status === "canceled"
    ) {
      // Bounced. Back to open: the period is still owed, and the overdue path
      // (card, then dunning) picks it up from here.
      const code =
        intent.last_payment_error?.decline_code ?? intent.last_payment_error?.code ?? null;
      await service
        .from("subscription_invoices")
        .update({
          status: "open",
          settlement_intent: null,
          settlement_failure: failureMessage(code),
        })
        .eq("id", invoice.id)
        .eq("status", "processing");
      return { settled: false, failed: true, pending: false };
    }

    // processing / requires_action — still in flight.
    return { settled: false, failed: false, pending: true };
  } catch (err) {
    // A lookup failure is not a payment failure: leave the invoice in flight and
    // ask again next sweep rather than inventing an outcome.
    console.error("[native-payments] could not read a debit's status:", err);
    return { settled: false, failed: false, pending: true };
  }
}

/** In-flight debits, oldest first — the sweep's poll list. */
/**
 * Open invoices nobody has tried to collect yet — no debit submitted, no card
 * taken. These are what the sweep initiates against.
 *
 * An invoice can reach this state from several directions: raised when someone
 * cleared the paywall, raised while the org had no linked account and left
 * waiting for one, or raised by a renewal whose collection attempt died
 * mid-flight. Before this existed the sweep only ever polled debits that were
 * already running, so an invoice with no debit behind it was collected only if
 * the renewal path happened to touch it again — which, for a first period, is
 * not until the period ends.
 */
export async function uncollectedInvoices(
  service: ServiceClient,
  limit = 100,
): Promise<SubscriptionInvoice[]> {
  const { data } = await service
    .from("subscription_invoices")
    .select("*")
    .eq("status", "open")
    .is("settlement_intent", null)
    .order("issued_at", { ascending: true })
    .limit(limit);
  return (data as SubscriptionInvoice[] | null) ?? [];
}

export async function inFlightDebits(
  service: ServiceClient,
  limit = 100,
): Promise<SubscriptionInvoice[]> {
  const { data } = await service
    .from("subscription_invoices")
    .select("*")
    .eq("status", "processing")
    .order("settlement_started_at", { ascending: true })
    .limit(limit);
  return (data as SubscriptionInvoice[] | null) ?? [];
}
