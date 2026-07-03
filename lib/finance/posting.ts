// lib/finance/posting.ts
// FundExecs Finance Engine — Phase 3/4: AR/AP → General Ledger posting.
//
// Pure, framework-free logic (no DB, no I/O): given an invoice's or payment's
// amounts and the resolved GL account ids, it builds the balanced journal lines
// to post through the Phase-1 ledger. Signed-amount convention (same as
// ledger.ts): debit > 0, credit < 0; the returned lines always net to zero.
import { round4, type JournalLineInput } from "./ledger";

/** Round to 2dp — invoice/payment money scale (numeric(20,2)). */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface InvoicePostingLine {
  incomeAccountId?: string | null; // revenue (AR) / expense (AP) account for the line
  lineSubtotal: number;
  lineTax: number;
}

export interface InvoicePostingAccounts {
  // AR control (receivable) or AP control (payable) account.
  controlAccountId: string;
  // Where line tax posts (output tax for AR, input tax for AP). Required if any
  // line carries tax.
  taxAccountId?: string | null;
  // Fallback revenue/expense account for lines with no income account of their own.
  defaultLineAccountId?: string | null;
}

/**
 * The balanced journal lines for an invoice (AR) or bill (AP).
 *
 *  receivable:  Dr AR control (total) · Cr revenue (subtotals) · Cr tax
 *  payable:     Dr expense (subtotals) · Dr tax · Cr AP control (total)
 *
 * Revenue/expense lines are combined per account. Throws if an account cannot be
 * resolved (a line without an income account and no default; tax without a tax
 * account), so an unbalanced or mis-coded entry can never be built.
 */
export function invoiceJournalLines(
  kind: "receivable" | "payable",
  currency: string,
  lines: InvoicePostingLine[],
  accounts: InvoicePostingAccounts,
): JournalLineInput[] {
  const bySubtotal = new Map<string, number>();
  let tax = 0;
  for (const l of lines) {
    const acct = l.incomeAccountId ?? accounts.defaultLineAccountId;
    if (!acct) {
      throw new Error("posting: invoice line has no income account and no default was provided");
    }
    bySubtotal.set(acct, round2((bySubtotal.get(acct) ?? 0) + l.lineSubtotal));
    tax = round2(tax + l.lineTax);
  }
  const subtotal = round2([...bySubtotal.values()].reduce((s, v) => s + v, 0));
  const total = round2(subtotal + tax);
  if (tax > 0 && !accounts.taxAccountId) {
    throw new Error("posting: invoice carries tax but no tax account was provided");
  }

  // Sign the control side vs the revenue/expense side by document kind.
  const controlSign = kind === "receivable" ? 1 : -1; // AR debits control, AP credits
  const lineSign = -controlSign; // the opposite side

  const out: JournalLineInput[] = [
    { accountId: accounts.controlAccountId, amount: round2(controlSign * total), currency },
  ];
  for (const [acct, sub] of bySubtotal) {
    out.push({ accountId: acct, amount: round2(lineSign * sub), currency });
  }
  if (tax > 0) {
    out.push({ accountId: accounts.taxAccountId as string, amount: round2(lineSign * tax), currency });
  }
  return out;
}

/**
 * The balanced journal lines for a payment.
 *
 *  inbound  (customer pays us): Dr cash · Cr AR control
 *  outbound (we pay a vendor):  Dr AP control · Cr cash
 */
export function paymentJournalLines(
  direction: "inbound" | "outbound",
  currency: string,
  amount: number,
  controlAccountId: string,
  cashAccountId: string,
): JournalLineInput[] {
  const amt = round2(amount);
  if (!(amt > 0)) throw new Error("posting: payment amount must be positive");
  if (direction === "inbound") {
    return [
      { accountId: cashAccountId, amount: amt, currency },
      { accountId: controlAccountId, amount: round2(-amt), currency },
    ];
  }
  return [
    { accountId: controlAccountId, amount: amt, currency },
    { accountId: cashAccountId, amount: round2(-amt), currency },
  ];
}

/** True when the signed base amounts net to zero (a sanity check for callers). */
export function isBalanced(lines: JournalLineInput[]): boolean {
  return round4(lines.reduce((s, l) => s + (l.baseAmount ?? l.amount), 0)) === 0;
}
