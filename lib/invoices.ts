// lib/invoices.ts
// Payment-link invoices — the pure core (no DB, no I/O), unit-testable with
// small fixtures. A firm drafts an invoice with line items; a public /pay/<token>
// link lets anyone pay it via Stripe Embedded Checkout (see lib/invoices.server
// for persistence + fulfillment, lib/stripe for the checkout intent). Amounts
// are derived from the line items HERE so the server never trusts a client-sent
// total — the same "recompute, don't trust" posture lib/stripe uses for packs.
import type {
  InvoiceStatus,
  PaymentInvoice,
  PaymentInvoiceLineItem,
} from "@/lib/supabase/database.types";

export type { InvoiceStatus, PaymentInvoice, PaymentInvoiceLineItem };

// Stripe's minimum chargeable amount is ~$0.50; reject invoices below it so a
// pay link can never open a checkout Stripe will refuse.
export const MIN_INVOICE_CENTS = 50;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// A single line item's subtotal in minor units. Quantity and unit are clamped
// to non-negative integers so a malformed row can't produce a negative charge.
export function lineItemSubtotalCents(item: PaymentInvoiceLineItem): number {
  const qty = Math.max(0, Math.floor(item.quantity));
  const unit = Math.max(0, Math.floor(item.unitAmountCents));
  return qty * unit;
}

// Invoice total in minor units — the single source of truth for what Stripe
// charges. Never read a stored total for the charge; recompute from items.
export function invoiceTotalCents(items: PaymentInvoiceLineItem[]): number {
  return (items ?? []).reduce((sum, it) => sum + lineItemSubtotalCents(it), 0);
}

// Minor units → localized currency string. Defaults to USD; any ISO-4217 code
// renders with its own symbol.
export function formatMoney(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  open: "Awaiting payment",
  paid: "Paid",
  void: "Void",
};

// Only an `open` invoice is payable through its public link.
export function isPayable(status: InvoiceStatus): boolean {
  return status === "open";
}

// Next sequential invoice number for an org given its highest existing one.
// Format INV-0001; tolerant of a missing or oddly-formatted previous value.
export function nextInvoiceNumber(prev: string | null | undefined): string {
  const digits = prev ? Number(String(prev).replace(/[^0-9]/g, "")) : 0;
  const next = (Number.isFinite(digits) ? digits : 0) + 1;
  return `INV-${String(next).padStart(4, "0")}`;
}

// The shape a create form / server action hands in. camelCase at the boundary;
// lib/invoices.server maps it onto the snake_case row.
export interface InvoiceDraft {
  title: string;
  description?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  currency?: string;
  number?: string | null;
  dueDate?: string | null;
  facilitatedPaymentUrl?: string | null;
  lineItems: PaymentInvoiceLineItem[];
}

export type InvoiceValidation =
  | { ok: true; items: PaymentInvoiceLineItem[]; totalCents: number }
  | { ok: false; error: string };

// Validate a draft and return the cleaned line items + derived total. Blank
// rows (no description) are dropped; a row with a bad quantity/price is a hard
// error so a typo never silently bills the wrong amount.
export function validateInvoiceDraft(draft: InvoiceDraft): InvoiceValidation {
  const title = (draft.title ?? "").trim();
  if (!title) return { ok: false, error: "Add an invoice title." };

  const email = draft.customerEmail?.trim();
  if (email && !EMAIL_RE.test(email))
    return { ok: false, error: "Enter a valid customer email." };

  const items: PaymentInvoiceLineItem[] = [];
  for (const raw of draft.lineItems ?? []) {
    const description = (raw.description ?? "").trim();
    if (!description) continue; // drop blank rows
    const quantity = Math.floor(Number(raw.quantity));
    const unitAmountCents = Math.round(Number(raw.unitAmountCents));
    if (!Number.isFinite(quantity) || quantity <= 0)
      return { ok: false, error: `Quantity for "${description}" must be a positive number.` };
    if (!Number.isFinite(unitAmountCents) || unitAmountCents < 0)
      return { ok: false, error: `Price for "${description}" must be zero or more.` };
    items.push({ description, quantity, unitAmountCents });
  }

  if (items.length === 0) return { ok: false, error: "Add at least one line item." };

  const totalCents = invoiceTotalCents(items);
  if (totalCents < MIN_INVOICE_CENTS)
    return {
      ok: false,
      error: `Invoice total must be at least ${formatMoney(MIN_INVOICE_CENTS, draft.currency)}.`,
    };

  return { ok: true, items, totalCents };
}
