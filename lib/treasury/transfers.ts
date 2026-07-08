// lib/treasury/transfers.ts
// ACH money movement against linked bank accounts, on the platform's single
// Stripe account. A `deposit` pulls funds in via an ACH-debit PaymentIntent
// (payment_method_types: us_bank_account); a `withdrawal` pushes funds out via a
// Stripe payout. This is the native, Stripe-rails answer to adrianhajdin/banking's
// transfer flow — no Plaid, no Dwolla, no Connect.
//
// Shape mirrors the rest of lib/: the VALIDATION + STATUS-MACHINE core is PURE
// (no DB, no key, unit-testable), the DB helpers are thin best-effort wrappers,
// and the Stripe execution is gated behind stripeConfigured() so the whole
// module imports and runs keyless in CI. Money never moves without a live key.
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  LinkedAccount,
  TransferDirection,
  TransferStatus,
  TreasuryTransfer,
} from "@/lib/supabase/database.types";
import { stripeConfigured, getStripe } from "@/lib/stripe";

type Client = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// PURE — taxonomy, validation, and the status machine (unit-testable)
// ---------------------------------------------------------------------------
export const TRANSFER_STATUSES: TransferStatus[] = ["pending", "processing", "succeeded", "failed", "canceled"];
export const TRANSFER_DIRECTIONS: TransferDirection[] = ["deposit", "withdrawal"];
const TERMINAL: TransferStatus[] = ["succeeded", "failed", "canceled"];

// A status from which no further transition is allowed. Pure.
export function isTerminal(status: TransferStatus): boolean {
  return TERMINAL.includes(status);
}

export interface TransferLimits {
  /** Smallest allowed transfer, in minor units. */
  minCents: number;
  /** Largest allowed transfer, in minor units. */
  maxCents: number;
}

// Conservative default bounds ($1 – $50,000); a caller can widen/narrow per org.
export const DEFAULT_LIMITS: TransferLimits = { minCents: 100, maxCents: 5_000_000 };

const dollars = (cents: number): string => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

export interface ValidateTransferInput {
  direction: TransferDirection;
  amountCents: number;
  account: Pick<LinkedAccount, "status" | "balance_cents"> | null;
  limits?: TransferLimits;
}

/**
 * Validate a proposed transfer before any money moves. Returns every problem it
 * finds (so the UI can show them together) — an empty list means go. Pure.
 */
export function validateTransfer(input: ValidateTransferInput): { ok: boolean; errors: string[] } {
  const limits = input.limits ?? DEFAULT_LIMITS;
  const errors: string[] = [];
  const amt = input.amountCents;

  if (!Number.isInteger(amt) || amt <= 0) {
    errors.push("Enter a valid transfer amount.");
  } else {
    if (amt < limits.minCents) errors.push(`Minimum transfer is ${dollars(limits.minCents)}.`);
    if (amt > limits.maxCents) errors.push(`Maximum transfer is ${dollars(limits.maxCents)}.`);
  }

  if (!input.account) {
    errors.push("Select a linked account.");
  } else if (input.account.status !== "active") {
    errors.push("That account isn’t active — reconnect it first.");
  } else if (
    input.direction === "withdrawal" &&
    typeof input.account.balance_cents === "number" &&
    Number.isInteger(amt) &&
    amt > input.account.balance_cents
  ) {
    errors.push("Amount exceeds the account’s available balance.");
  }

  return { ok: errors.length === 0, errors };
}

// The allowed status transitions. A transfer starts `pending`, moves through
// `processing` while Stripe settles, and ends terminal. Pure.
const TRANSITIONS: Record<TransferStatus, TransferStatus[]> = {
  pending: ["processing", "succeeded", "failed", "canceled"],
  processing: ["succeeded", "failed", "canceled"],
  succeeded: [],
  failed: [],
  canceled: [],
};

export function canTransition(from: TransferStatus, to: TransferStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

// Map a Stripe PaymentIntent status (deposit rail) to our transfer status. Pure.
export function mapStripePaymentIntentStatus(status: string): TransferStatus {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "processing":
      return "processing";
    case "canceled":
      return "canceled";
    default:
      // requires_payment_method / requires_action / requires_confirmation, etc.
      return "pending";
  }
}

// Map a Stripe Payout status (withdrawal rail) to our transfer status. Pure.
export function mapStripePayoutStatus(status: string): TransferStatus {
  switch (status) {
    case "paid":
      return "succeeded";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    default:
      // pending / in_transit
      return "processing";
  }
}

// ---------------------------------------------------------------------------
// DB — best-effort persistence (RLS-scoped)
// ---------------------------------------------------------------------------
export interface CreateTransferInput {
  direction: TransferDirection;
  amountCents: number;
  linkedAccountId: string;
  currency?: string;
  description?: string | null;
  idempotencyKey?: string | null;
}

/**
 * Insert a `pending` transfer row. Returns the row or an error message. The
 * unique (org, idempotency_key) index makes a double-submit a no-op: a conflict
 * returns the existing transfer rather than a second one.
 */
export async function createTransfer(
  supabase: Client,
  orgId: string,
  userId: string | null,
  input: CreateTransferInput,
): Promise<{ transfer?: TreasuryTransfer; error?: string }> {
  try {
    const { data, error } = await supabase
      .from("treasury_transfers")
      .insert({
        organization_id: orgId,
        linked_account_id: input.linkedAccountId,
        direction: input.direction,
        amount_cents: input.amountCents,
        currency: input.currency ?? "usd",
        status: "pending",
        description: input.description ?? null,
        idempotency_key: input.idempotencyKey ?? null,
        created_by: userId,
      })
      .select("*")
      .single();
    if (error) {
      // Idempotency-key collision → return the transfer that already exists.
      if (input.idempotencyKey) {
        const { data: existing } = await supabase
          .from("treasury_transfers")
          .select("*")
          .eq("organization_id", orgId)
          .eq("idempotency_key", input.idempotencyKey)
          .maybeSingle();
        if (existing) return { transfer: existing as TreasuryTransfer };
      }
      return { error: "Could not record the transfer." };
    }
    return { transfer: data as TreasuryTransfer };
  } catch {
    return { error: "Could not record the transfer." };
  }
}

// The org's transfers, newest first. Best-effort — returns [] on any failure.
export async function listTransfers(supabase: Client, orgId: string, limit = 50): Promise<TreasuryTransfer[]> {
  try {
    const { data } = await supabase
      .from("treasury_transfers")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []) as TreasuryTransfer[];
  } catch {
    return [];
  }
}

/**
 * Advance a transfer's status, honoring the state machine. A disallowed
 * transition is ignored (returns false) so a late/duplicate Stripe event can't
 * move a terminal transfer. Best-effort.
 */
export async function updateTransferStatus(
  supabase: Client,
  transferId: string,
  from: TransferStatus,
  to: TransferStatus,
  patch: { failureReason?: string | null } = {},
): Promise<boolean> {
  if (!canTransition(from, to)) return false;
  try {
    const { error } = await supabase
      .from("treasury_transfers")
      .update({ status: to, failure_reason: patch.failureReason ?? null })
      .eq("id", transferId)
      .eq("status", from); // optimistic guard against a racing update
    return !error;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Stripe execution — gated; money only moves with a live key
// ---------------------------------------------------------------------------
/**
 * Execute a recorded transfer on Stripe: a deposit as an ACH-debit PaymentIntent
 * off the account's saved us_bank_account PaymentMethod, a withdrawal as a
 * payout. Returns the resulting status + Stripe reference. Never throws; a
 * missing key or Stripe error yields a `failed` status the caller persists.
 */
export async function executeTransfer(
  transfer: Pick<TreasuryTransfer, "id" | "direction" | "amount_cents" | "currency">,
  account: Pick<LinkedAccount, "stripe_payment_method_id">,
): Promise<{ status: TransferStatus; reference?: string; failureReason?: string }> {
  if (!stripeConfigured()) {
    return { status: "failed", failureReason: "Payments are not configured." };
  }
  try {
    const stripe = getStripe();
    if (transfer.direction === "deposit") {
      if (!account.stripe_payment_method_id) {
        return { status: "failed", failureReason: "Account is not set up for ACH debit." };
      }
      const intent = await stripe.paymentIntents.create(
        {
          amount: transfer.amount_cents,
          currency: transfer.currency,
          payment_method_types: ["us_bank_account"],
          payment_method: account.stripe_payment_method_id,
          confirm: true,
          mandate_data: {
            customer_acceptance: { type: "offline", offline: {} },
          },
        },
        { idempotencyKey: `treasury_transfer_${transfer.id}` },
      );
      return { status: mapStripePaymentIntentStatus(intent.status), reference: intent.id };
    }
    // Withdrawal — push funds out via a payout in the platform's currency.
    const payout = await stripe.payouts.create(
      { amount: transfer.amount_cents, currency: transfer.currency },
      { idempotencyKey: `treasury_transfer_${transfer.id}` },
    );
    return { status: mapStripePayoutStatus(payout.status), reference: payout.id };
  } catch (err) {
    const failureReason = err instanceof Error ? err.message : "Transfer failed at the payment processor.";
    return { status: "failed", failureReason };
  }
}

export const __test = { TRANSITIONS, dollars };
