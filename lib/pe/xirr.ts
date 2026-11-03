// lib/pe/xirr.ts
// Dated cash-flow returns. Pure. IRR uses actual dates (act/365) — not the annual
// approximation — and returns null rather than a number when no root exists.

export interface DatedFlow {
  /** ISO date, yyyy-mm-dd. */
  date: string;
  /** Negative = capital in, positive = proceeds out. */
  amount: number;
}

const DAY = 86_400_000;

function toTime(d: string): number | null {
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
}

export interface FlowStats {
  invested: number;
  returned: number;
  moic: number | null;
  /** Decimal (0.2 = 20%); null when undefined (no sign change, bad dates, or no solution). */
  irr: number | null;
  firstDate: string | null;
  lastDate: string | null;
  badDates: number;
}

export function flowStats(flows: DatedFlow[]): FlowStats {
  const valid = flows.map((f) => ({ ...f, t: toTime(f.date) })).filter((f): f is DatedFlow & { t: number } => f.t !== null && Number.isFinite(f.amount));
  const badDates = flows.length - valid.length;
  const invested = valid.filter((f) => f.amount < 0).reduce((s, f) => s - f.amount, 0);
  const returned = valid.filter((f) => f.amount > 0).reduce((s, f) => s + f.amount, 0);
  const moic = invested > 0 ? Math.round((returned / invested) * 10000) / 10000 : null;
  if (valid.length < 2 || invested === 0 || returned === 0) {
    return { invested, returned, moic, irr: null, firstDate: null, lastDate: null, badDates };
  }
  valid.sort((a, b) => a.t - b.t);
  const t0 = valid[0].t;
  const npv = (r: number) => valid.reduce((s, f) => s + f.amount / Math.pow(1 + r, (f.t - t0) / (365 * DAY)), 0);

  let lo = -0.99;
  let hi = 10;
  let irr: number | null = null;
  if (npv(lo) * npv(hi) < 0) {
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (npv(lo) * npv(mid) <= 0) hi = mid;
      else lo = mid;
    }
    irr = Math.round(((lo + hi) / 2) * 10000) / 10000;
  }
  return { invested, returned, moic, irr, firstDate: valid[0].date, lastDate: valid[valid.length - 1].date, badDates };
}
