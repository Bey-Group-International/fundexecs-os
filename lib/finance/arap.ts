// lib/finance/arap.ts
// FundExecs Finance Engine — Phase 3: the Accounts Receivable / Accounts Payable
// domain core.
//
// Pure, framework-free logic (no DB, no I/O): invoice line math and totals,
// invoice status derivation, receivables/payables aging, and payment allocation
// across open invoices. The server actions reuse this and it is unit-tested
// directly. Invoice money is carried at 2dp (mirroring the numeric(20,2) invoice
// columns) via `round2`; the underlying ledger postings stay at 4dp. All
// amounts are plain positive numbers — the AR/AP sign is implied by the invoice
// `kind` ('receivable' vs 'payable'), not the amount.
import { round4, type Money } from "./ledger";

/** Round to 2 decimal places (the invoice numeric(20,2) scale). */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// --- Invoice line math -------------------------------------------------------

/** A single invoice line as entered by the operator (before computation). */
export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
  // Tax rate as a fraction (0.2 = 20%). Defaults to 0 (no tax) when omitted.
  taxRate?: number;
}

/** A fully computed invoice line: subtotal, tax, and total resolved at 2dp. */
export interface ComputedInvoiceLine {
  lineNo: number;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  lineSubtotal: number;
  lineTax: number;
  lineTotal: number;
}

/** The computed lines plus the invoice-level subtotal, tax, and total. */
export interface InvoiceTotals {
  lines: ComputedInvoiceLine[];
  subtotal: number;
  tax: number;
  total: number;
}

/**
 * Compute an invoice's lines and totals. Per line: lineSubtotal = qty × unit
 * price, lineTax = lineSubtotal × taxRate, lineTotal = lineSubtotal + lineTax —
 * each rounded to 2dp so the stored line matches what the customer sees. Line
 * numbers are assigned from 1 in input order. The invoice totals are the 2dp
 * sums of the per-line amounts (summed from already-rounded lines, so
 * subtotal + tax === total holds exactly). Pure.
 */
export function computeInvoiceTotals(lines: InvoiceLineInput[]): InvoiceTotals {
  const computed: ComputedInvoiceLine[] = lines.map((l, i) => {
    const taxRate = l.taxRate ?? 0;
    const lineSubtotal = round2(l.quantity * l.unitPrice);
    const lineTax = round2(lineSubtotal * taxRate);
    const lineTotal = round2(lineSubtotal + lineTax);
    return {
      lineNo: i + 1,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxRate,
      lineSubtotal,
      lineTax,
      lineTotal,
    };
  });
  const subtotal = round2(computed.reduce((s, l) => s + l.lineSubtotal, 0));
  const tax = round2(computed.reduce((s, l) => s + l.lineTax, 0));
  const total = round2(computed.reduce((s, l) => s + l.lineTotal, 0));
  return { lines: computed, subtotal, tax, total };
}

// --- Invoice status ----------------------------------------------------------

export type InvoiceStatus = "draft" | "open" | "partial" | "paid" | "void";

/**
 * Derive an invoice's payment status from its total and amount paid. An invoice
 * with nothing applied is 'open', a fully (or over-) paid invoice is 'paid', and
 * anything in between is 'partial'. This never returns 'draft' or 'void' — those
 * are lifecycle states set explicitly by the operator, not derived from money.
 * A zero (or negative) total is treated as 'open' since there is nothing to pay.
 */
export function invoiceStatus(total: number, amountPaid: number): InvoiceStatus {
  if (total > 0 && amountPaid >= total) return "paid";
  if (amountPaid > 0 && amountPaid < total) return "partial";
  return "open";
}

// --- Aging -------------------------------------------------------------------

export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

// Whole days between two ISO (YYYY-MM-DD) dates, computed on the UTC calendar so
// the result is independent of the runtime's local timezone / DST.
const daysBetween = (later: string, earlier: string): number =>
  Math.round(
    (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000,
  );

/**
 * The aging bucket for a due date as of a report date. Days overdue = asOf −
 * dueDate on the UTC calendar: not yet due (≤ 0 days overdue) is 'current', then
 * 1–30, 31–60, 61–90, and anything more than 90 days overdue is '90+'. Pure.
 */
export function agingBucket(dueDate: string, asOf: string): AgingBucket {
  const overdue = daysBetween(asOf, dueDate);
  if (overdue <= 0) return "current";
  if (overdue <= 30) return "1-30";
  if (overdue <= 60) return "31-60";
  if (overdue <= 90) return "61-90";
  return "90+";
}

/** One outstanding invoice (or party balance) fed into an aging report. */
export interface AgingRow {
  partyId?: string;
  dueDate: string;
  outstanding: number;
}

/** Outstanding totals per aging bucket, plus the grand total. */
export interface AgingSummary {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total: number;
}

/**
 * Roll up outstanding balances into aging buckets as of a report date. Each
 * row's `outstanding` lands in the bucket for its due date; the per-bucket sums
 * and the grand total are rounded to 2dp. Pure.
 */
export function agingSummary(rows: AgingRow[], asOf: string): AgingSummary {
  const acc: AgingSummary = {
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
    total: 0,
  };
  for (const row of rows) {
    const amt = row.outstanding;
    switch (agingBucket(row.dueDate, asOf)) {
      case "current":
        acc.current += amt;
        break;
      case "1-30":
        acc.d1_30 += amt;
        break;
      case "31-60":
        acc.d31_60 += amt;
        break;
      case "61-90":
        acc.d61_90 += amt;
        break;
      case "90+":
        acc.d90_plus += amt;
        break;
    }
    acc.total += amt;
  }
  acc.current = round2(acc.current);
  acc.d1_30 = round2(acc.d1_30);
  acc.d31_60 = round2(acc.d31_60);
  acc.d61_90 = round2(acc.d61_90);
  acc.d90_plus = round2(acc.d90_plus);
  acc.total = round2(acc.total);
  return acc;
}

// --- Payment allocation ------------------------------------------------------

/** An open invoice a payment can be applied to, with its remaining balance. */
export interface PayableInvoice {
  id: string;
  outstanding: number;
  // ISO (YYYY-MM-DD) due date, used to order "oldest-first". Undefined sorts last.
  dueDate?: string;
}

/** How much of a payment is applied to one invoice. */
export interface Allocation {
  invoiceId: string;
  amount: number;
}

/** The applied allocations plus any payment amount left over (unapplied). */
export interface AllocationResult {
  allocations: Allocation[];
  unapplied: number;
}

/**
 * Allocate a payment across open invoices. Two strategies:
 *
 *  - "oldest-first" (default): invoices are sorted by due date ascending
 *    (undefined due dates last, then by id for stability) and filled to their
 *    full outstanding balance in turn until the payment is exhausted. Anything
 *    left after every invoice is settled becomes `unapplied` (an overpayment /
 *    credit). An invoice never receives more than its outstanding, and never
 *    more than the remaining payment.
 *
 *  - "proportional": the payment is split pro-rata by each invoice's outstanding
 *    share, each allocation rounded to 2dp. Any rounding remainder (so the parts
 *    sum exactly to the capped payment) is dropped onto the largest allocation.
 *    If the payment exceeds the total outstanding, every invoice is paid in full
 *    and the excess becomes `unapplied`.
 *
 * In both cases sum(allocations) + unapplied === round2(amount). Zero/negative
 * outstanding invoices are ignored. Pure.
 */
export function allocatePayment(
  amount: number,
  invoices: PayableInvoice[],
  strategy: "oldest-first" | "proportional" = "oldest-first",
): AllocationResult {
  const payment = round2(amount);
  const open = invoices.filter((inv) => round2(inv.outstanding) > 0);

  if (payment <= 0 || open.length === 0) {
    return { allocations: [], unapplied: payment > 0 ? payment : 0 };
  }

  if (strategy === "proportional") {
    return allocateProportional(payment, open);
  }
  return allocateOldestFirst(payment, open);
}

function allocateOldestFirst(payment: number, open: PayableInvoice[]): AllocationResult {
  // Oldest due date first; undefined due dates last; id as a stable tiebreaker.
  const sorted = [...open].sort((a, b) => {
    if (a.dueDate === b.dueDate) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    if (a.dueDate === undefined) return 1;
    if (b.dueDate === undefined) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  });
  const allocations: Allocation[] = [];
  let remaining = payment;
  for (const inv of sorted) {
    if (remaining <= 0) break;
    const apply = round2(Math.min(round2(inv.outstanding), remaining));
    if (apply <= 0) continue;
    allocations.push({ invoiceId: inv.id, amount: apply });
    remaining = round2(remaining - apply);
  }
  return { allocations, unapplied: round2(remaining) };
}

function allocateProportional(payment: number, open: PayableInvoice[]): AllocationResult {
  const totalOutstanding = round2(open.reduce((s, inv) => s + round2(inv.outstanding), 0));

  // Overpayment: settle every invoice in full and leave the rest unapplied.
  if (payment >= totalOutstanding) {
    const allocations = open.map((inv) => ({
      invoiceId: inv.id,
      amount: round2(inv.outstanding),
    }));
    return { allocations, unapplied: round2(payment - totalOutstanding) };
  }

  // Pro-rata split by outstanding share, capped at each invoice's outstanding.
  const allocations: Allocation[] = open.map((inv) => {
    const share = round2(Math.min(payment * (round2(inv.outstanding) / totalOutstanding), round2(inv.outstanding)));
    return { invoiceId: inv.id, amount: share };
  });

  // Push any rounding remainder onto the largest allocation so the parts sum
  // exactly to the payment.
  const allocated = round2(allocations.reduce((s, a) => s + a.amount, 0));
  const remainder = round2(payment - allocated);
  if (remainder !== 0 && allocations.length > 0) {
    let largest = 0;
    for (let i = 1; i < allocations.length; i++) {
      if (allocations[i].amount > allocations[largest].amount) largest = i;
    }
    allocations[largest].amount = round2(allocations[largest].amount + remainder);
  }

  return { allocations, unapplied: 0 };
}

// Re-exported so callers wiring AR/AP postings into the ledger share one rounding
// vocabulary (invoice totals at 2dp, ledger base amounts at 4dp).
export { round4 };
export type { Money };
