// lib/invoice-aging.ts
// Pure AR/AP aging-bucket logic for the Invoices UI. No DB, no I/O — the client
// board feeds it the outstanding balances it already renders, so the aging
// summary and the invoice list are computed from one source. Buckets mirror the
// server-side arap core (current / 1-30 / 31-60 / 61-90 / 90+) but are recomputed
// here client-side so the summary stays in lockstep with what the operator sees.

/** Keyed aging buckets, matching the standard receivables ladder. */
export type AgingBucketKey = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

/** One outstanding invoice fed into the aging roll-up. */
export interface AgingInput {
  /** ISO (YYYY-MM-DD) due date. */
  dueDate: string;
  /** Positive outstanding balance (total − amount paid). */
  outstanding: number;
}

/** Outstanding totals per bucket plus the grand total, all rounded to 2dp. */
export interface AgingBuckets {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total: number;
}

/** Round to 2 decimal places (the invoice numeric(20,2) scale). */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Whole days a due date is overdue as of a report date, on the UTC calendar so
 * the result is independent of the runtime timezone. Negative = not yet due.
 * Returns 0 for an unparseable date rather than NaN.
 */
export function daysOverdue(dueDate: string, asOf: string): number {
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const at = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(due) || Number.isNaN(at)) return 0;
  return Math.round((at - due) / 86_400_000);
}

/**
 * The aging bucket for a due date as of a report date: not yet due (≤ 0 days
 * overdue) is 'current', then 1–30, 31–60, 61–90, and anything more than 90 days
 * overdue is '90+'. Pure.
 */
export function agingBucketKey(dueDate: string, asOf: string): AgingBucketKey {
  const overdue = daysOverdue(dueDate, asOf);
  if (overdue <= 0) return "current";
  if (overdue <= 30) return "d1_30";
  if (overdue <= 60) return "d31_60";
  if (overdue <= 90) return "d61_90";
  return "d90_plus";
}

/**
 * Roll outstanding balances into aging buckets as of a report date. Rows with a
 * non-positive outstanding are ignored (nothing to age). Per-bucket sums and the
 * grand total are rounded to 2dp. Pure.
 */
export function summarizeAging(rows: AgingInput[], asOf: string): AgingBuckets {
  const acc: AgingBuckets = {
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
    total: 0,
  };
  for (const row of rows) {
    if (!(row.outstanding > 0)) continue;
    acc[agingBucketKey(row.dueDate, asOf)] += row.outstanding;
    acc.total += row.outstanding;
  }
  acc.current = round2(acc.current);
  acc.d1_30 = round2(acc.d1_30);
  acc.d31_60 = round2(acc.d31_60);
  acc.d61_90 = round2(acc.d61_90);
  acc.d90_plus = round2(acc.d90_plus);
  acc.total = round2(acc.total);
  return acc;
}
