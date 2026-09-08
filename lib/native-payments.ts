// lib/native-payments.ts
// How a subscription invoice gets collected — the pure half.
//
// Three ways money can reach us, in the order we want them:
//
//   ach_debit  — pull from the operator's own linked bank account. Native, cheap,
//                and it collects itself: nobody has to remember to send anything.
//   transfer   — the operator pushes a wire against printed remittance details,
//                and finance confirms it landed.
//   card       — the fallback, and the only one that settles instantly.
//
// The routing is a pure function of what an org has on file, so the decision is
// testable and the same everywhere it is asked. Execution lives in
// lib/native-payments.server.
import type { SubscriptionInvoice } from "@/lib/subscription-invoices";

export type SettlementRoute = "ach_debit" | "transfer" | "card" | "none";

export interface SettlementCapability {
  /** An active linked bank account with a usable payment method. */
  hasLinkedAccount: boolean;
  /** Remittance details are configured, so a wire has somewhere to go. */
  hasRemittance: boolean;
  /** A card is on file and a processor is configured. */
  hasCard: boolean;
}

/**
 * The route to try first. Native rails come before the processor: an ACH debit
 * costs cents and collects itself, a wire costs nothing but needs a human, and
 * a card is the expensive instant option we fall back to.
 */
export function preferredRoute(cap: SettlementCapability): SettlementRoute {
  if (cap.hasLinkedAccount) return "ach_debit";
  if (cap.hasRemittance) return "transfer";
  if (cap.hasCard) return "card";
  return "none";
}

/**
 * The route to use once an invoice is overdue.
 *
 * A debit that has already bounced does not get tried again on the same rail —
 * the account said no, and asking twice just collects another return fee. Past
 * the due date the card is what is left.
 */
export function overdueRoute(
  cap: SettlementCapability,
  invoice: Pick<SubscriptionInvoice, "settlement_failure">,
): SettlementRoute {
  if (cap.hasCard) return "card";
  // No card: one more debit attempt is worth it only if we have never had one
  // bounce. Otherwise there is nothing left to try automatically.
  if (cap.hasLinkedAccount && !invoice.settlement_failure) return "ach_debit";
  return "none";
}

// ---------------------------------------------------------------------------
// ACH timing
// ---------------------------------------------------------------------------

// A submitted debit is neither collected nor failed for several business days.
// Stripe reports most us_bank_account debits as succeeded within 4 business days
// and surfaces returns for up to 2 more; this is how long we keep waiting before
// treating silence as a problem worth telling someone about.
export const ACH_EXPECTED_DAYS = 5;
export const ACH_STALE_DAYS = 10;

/** When a debit submitted at `startedAt` is expected to have cleared. */
export function expectedClearingDate(startedAt: Date): Date {
  return new Date(startedAt.getTime() + ACH_EXPECTED_DAYS * 86_400_000);
}

/**
 * Whether an in-flight debit has been in flight too long to keep waiting on
 * quietly. Not a failure — ACH really is slow — but past this it stops being
 * normal, and an operator staring at "processing" deserves to be told.
 */
export function isSettlementStale(
  invoice: Pick<SubscriptionInvoice, "settlement_started_at">,
  now: Date,
): boolean {
  if (!invoice.settlement_started_at) return false;
  const started = new Date(invoice.settlement_started_at).getTime();
  return now.getTime() - started > ACH_STALE_DAYS * 86_400_000;
}

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

// ACH returns that mean "this account will never work" as opposed to "not right
// now". A retry on a closed or invalid account is guaranteed to bounce again and
// earns another return fee, so these end the rail rather than rescheduling it.
const PERMANENT_FAILURE_CODES = new Set([
  "account_closed",
  "no_account",
  "invalid_account_number",
  "account_frozen",
  "debit_not_authorized",
  "branch_does_not_exist",
  "invalid_currency",
]);

/** Whether a bounced debit is worth ever retrying on the same account. */
export function isPermanentFailure(code: string | null | undefined): boolean {
  return code ? PERMANENT_FAILURE_CODES.has(code) : false;
}

/**
 * What to tell the operator about a bounced debit. Return codes are meaningless
 * to the person who has to fix it, so each maps to the action it implies.
 */
export function failureMessage(code: string | null | undefined): string {
  switch (code) {
    case "insufficient_funds":
      return "Your bank returned the payment for insufficient funds.";
    case "account_closed":
      return "That bank account is closed. Link another one to keep paying by transfer.";
    case "no_account":
    case "invalid_account_number":
      return "Your bank did not recognise that account. Please re-link it.";
    case "account_frozen":
      return "Your bank has frozen that account, so the payment could not be collected.";
    case "debit_not_authorized":
      return "Your bank has not authorised debits from that account.";
    default:
      return "The payment could not be collected from your bank account.";
  }
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** One line describing an in-flight collection, for the Wallet. */
export function settlementSummary(
  invoice: Pick<SubscriptionInvoice, "status" | "settlement_started_at" | "settlement_failure">,
  now: Date = new Date(),
): string | null {
  if (invoice.status === "processing" && invoice.settlement_started_at) {
    if (isSettlementStale(invoice, now)) {
      return "This payment is taking longer than usual to clear. We're still waiting on your bank — nothing further is needed from you yet.";
    }
    const expected = expectedClearingDate(new Date(invoice.settlement_started_at));
    return `Collecting from your linked account — expected to clear by ${expected.toLocaleDateString(
      "en-US",
      { month: "long", day: "numeric" },
    )}. Your credits are released when it does.`;
  }
  if (invoice.status === "open" && invoice.settlement_failure) {
    return invoice.settlement_failure;
  }
  return null;
}
