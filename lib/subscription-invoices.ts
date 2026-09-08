// lib/subscription-invoices.ts
// Invoice-settled subscriptions — the pure half.
//
// A subscription period is paid for by an invoice the operator settles by bank
// transfer. That is the native path: no processor sits in the loop, and the
// money arrives in FundExecs' own account. A card is the FALLBACK, used when an
// invoice passes its due date unsettled, or when no remittance details are
// configured for the operator to pay against at all.
//
// Everything here is pure so the terms, the overdue boundary and the display
// state are testable without a database — the settlement itself lives in
// lib/subscription-invoices.server.
import { formatUsd, type PlanInterval, type PlanKey } from "@/lib/billing";

// 'processing' is money in flight: a bank debit has been submitted but ACH does
// not clear (or bounce) for days, and an invoice in that state has collected
// nothing yet.
export type SubscriptionInvoiceStatus =
  | "open"
  | "processing"
  | "paid"
  | "void"
  | "written_off";
export type SettlementMethod = "bank_transfer" | "ach_debit" | "card" | "manual" | "credit";

export interface SubscriptionInvoice {
  id: string;
  organization_id: string;
  subscription_id: string | null;
  number: string;
  plan: PlanKey;
  interval: PlanInterval;
  period_start: string;
  period_end: string;
  amount_usd: number;
  credits: number;
  status: SubscriptionInvoiceStatus;
  issued_at: string;
  due_at: string;
  paid_at: string | null;
  paid_via: SettlementMethod | null;
  payment_reference: string | null;
  applied_at: string | null;
  /** The bank debit in flight, and what became of the last one. */
  settlement_intent: string | null;
  settlement_started_at: string | null;
  settlement_failure: string | null;
  settlement_attempts: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

// How long an operator has to settle before the card fallback runs. Two weeks
// is long enough for a wire to clear a finance department and short enough that
// unpaid access does not compound for a full extra period.
export const NET_TERMS_DAYS = 14;

/** When an invoice issued at `issuedAt` falls due. */
export function dueDate(issuedAt: Date, termsDays: number = NET_TERMS_DAYS): Date {
  return new Date(issuedAt.getTime() + termsDays * 86_400_000);
}

/** Whether an open invoice has passed its due date — the trigger for the fallback. */
export function isOverdue(
  invoice: Pick<SubscriptionInvoice, "status" | "due_at">,
  now: Date,
): boolean {
  return invoice.status === "open" && new Date(invoice.due_at).getTime() <= now.getTime();
}

/** Whole days until an open invoice is due; negative once it is overdue. */
export function daysUntilDue(
  invoice: Pick<SubscriptionInvoice, "due_at">,
  now: Date,
): number {
  return Math.ceil((new Date(invoice.due_at).getTime() - now.getTime()) / 86_400_000);
}

/** Whether a settled invoice still owes the operator its period's credits. */
export function awaitingApplication(
  invoice: Pick<SubscriptionInvoice, "status" | "applied_at">,
): boolean {
  return invoice.status === "paid" && !invoice.applied_at;
}

// ---------------------------------------------------------------------------
// Remittance details
// ---------------------------------------------------------------------------

// Where an operator sends the transfer. Held in env rather than the repo: these
// are the company's own receiving details, they differ per deployment, and a
// deployment that has not set them has no native way to be paid — which is
// exactly the condition that hands settlement to the card fallback.
export interface RemittanceDetails {
  bankName: string;
  accountName: string;
  accountNumber: string;
  routingNumber: string;
  swift: string;
  /** Free-text extra line (intermediary bank, address, etc.). */
  notes: string;
}

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

/**
 * The configured remittance details, or null when this deployment cannot be
 * paid by transfer. Null is a real state, not an error: it means the native rail
 * cannot settle and the card fallback owns the charge.
 */
export function remittanceDetails(): RemittanceDetails | null {
  const bankName = env("FUNDEXECS_REMITTANCE_BANK_NAME");
  const accountName = env("FUNDEXECS_REMITTANCE_ACCOUNT_NAME");
  const accountNumber = env("FUNDEXECS_REMITTANCE_ACCOUNT_NUMBER");
  // A transfer needs somewhere to go and someone to go to. Without at least the
  // bank, the payee and the account, the instructions are unusable, so treat a
  // half-filled configuration as unconfigured rather than showing an operator
  // something they cannot act on.
  if (!bankName || !accountName || !accountNumber) return null;
  return {
    bankName,
    accountName,
    accountNumber,
    routingNumber: env("FUNDEXECS_REMITTANCE_ROUTING"),
    swift: env("FUNDEXECS_REMITTANCE_SWIFT"),
    notes: env("FUNDEXECS_REMITTANCE_NOTES"),
  };
}

/** Whether this deployment can be paid by transfer at all. */
export function remittanceConfigured(): boolean {
  return remittanceDetails() !== null;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export type InvoiceHealth =
  | "due"
  | "due_soon"
  | "overdue"
  | "collecting"
  | "settled"
  | "closed";

/** How an invoice should read to the operator looking at their wallet. */
export function invoiceHealth(
  invoice: Pick<SubscriptionInvoice, "status" | "due_at">,
  now: Date = new Date(),
): InvoiceHealth {
  if (invoice.status === "paid") return "settled";
  if (invoice.status === "void" || invoice.status === "written_off") return "closed";
  // Money already on its way is not overdue, however long the bank takes.
  if (invoice.status === "processing") return "collecting";
  if (isOverdue(invoice, now)) return "overdue";
  return daysUntilDue(invoice, now) <= 3 ? "due_soon" : "due";
}

/** One line describing what the operator owes and by when. */
export function invoiceSummary(
  invoice: Pick<SubscriptionInvoice, "status" | "due_at" | "amount_usd" | "number">,
  now: Date = new Date(),
): string {
  const amount = formatUsd(invoice.amount_usd);
  switch (invoiceHealth(invoice, now)) {
    case "settled":
      return `${invoice.number} — ${amount} received. Thank you.`;
    case "collecting":
      return `${invoice.number} — ${amount} is being collected from your linked account.`;
    case "closed":
      return `${invoice.number} — ${amount}, no longer payable.`;
    case "overdue": {
      const days = Math.abs(daysUntilDue(invoice, now));
      return `${invoice.number} — ${amount} is ${days} day(s) overdue. We'll charge your card on file if one is saved.`;
    }
    default: {
      const days = daysUntilDue(invoice, now);
      return `${invoice.number} — ${amount} due in ${days} day(s). Pay by transfer using the reference below.`;
    }
  }
}

/** The reference an operator should quote on the transfer so it reconciles. */
export function paymentReferenceFor(invoice: Pick<SubscriptionInvoice, "number">): string {
  return invoice.number;
}
