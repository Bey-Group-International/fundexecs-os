// lib/finance/cashflow.ts
// FundExecs Finance Engine — Phase 2: the cashflow projection domain core.
//
// Pure, framework-free logic (no DB, no I/O): given an opening cash balance and
// a stream of dated, signed cash events, it buckets them by day/week/month,
// carries a running balance forward, and surfaces the minimum balance and any
// shortfall (a bucket that closes below zero). A run-rate helper turns trailing
// actuals into a per-day burn/earn figure that can be overlaid on the schedule.
//
// Amount convention (identical to banking.ts): money IN is positive, money OUT
// is negative. All money math flows through round4 to mirror the numeric(20,4)
// ledger scale. All date math is UTC-only — Date.parse(`${date}T00:00:00Z`) and
// Date.UTC — so a bucket boundary never shifts with the host's timezone.
import { round4, type Money } from "./ledger";

/** A single dated cash movement. Signed: inflow > 0, outflow < 0. */
export interface CashflowEvent {
  // ISO date (YYYY-MM-DD) the cash moves.
  date: string;
  // Signed amount: inflow > 0, outflow < 0.
  amount: Money;
  label?: string;
  category?: string;
}

export type CashflowGranularity = "day" | "week" | "month";

/** One aggregation period of the projection, with its carried closing balance. */
export interface CashflowBucket {
  // Inclusive ISO period boundaries containing every event in the bucket.
  periodStart: string;
  periodEnd: string;
  // Sum of positive amounts in the bucket (≥ 0).
  inflow: Money;
  // Sum of negative amounts in the bucket (≤ 0).
  outflow: Money;
  // inflow + outflow.
  net: Money;
  // Running balance after applying this bucket's net.
  closingBalance: Money;
}

export interface CashflowProjection {
  openingBalance: Money;
  // Emitted ascending by periodStart. Only periods with ≥ 1 in-range event are
  // emitted; the running balance is still continuous across skipped gaps.
  buckets: CashflowBucket[];
  // Balance after the last bucket (== openingBalance when there are no buckets).
  closingBalance: Money;
  // The smallest bucket closingBalance (== openingBalance when no buckets).
  minBalance: Money;
  // periodStart of the bucket that hit minBalance, or null when no buckets.
  minBalanceDate: string | null;
  // True when any bucket closes below zero (cash goes negative at some point).
  shortfall: boolean;
}

const DAY_MS = 86_400_000;

/** ms at UTC midnight of an ISO date. */
const toMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);

/** ISO YYYY-MM-DD for a UTC-midnight ms value. */
const toISO = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The ISO date `n` days after `date` (n may be negative). Pure, UTC. */
const addDays = (date: string, n: number): string => toISO(toMs(date) + n * DAY_MS);

/**
 * The inclusive ISO period boundaries containing `date` at the given
 * granularity. "day" → the date itself (start === end). "week" → the enclosing
 * Monday..Sunday (ISO week). "month" → the 1st..last calendar day of the month.
 * All arithmetic is UTC so boundaries are timezone-stable.
 */
export function bucketKey(
  date: string,
  granularity: CashflowGranularity,
): { start: string; end: string } {
  const ms = toMs(date);
  if (granularity === "day") {
    const iso = toISO(ms);
    return { start: iso, end: iso };
  }
  const d = new Date(ms);
  if (granularity === "week") {
    // getUTCDay: 0 = Sunday .. 6 = Saturday. Days back to Monday.
    const fromMonday = (d.getUTCDay() + 6) % 7;
    const startMs = ms - fromMonday * DAY_MS;
    return { start: toISO(startMs), end: toISO(startMs + 6 * DAY_MS) };
  }
  // month: first day .. last day (day 0 of the next month is the last of this one).
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return { start: toISO(Date.UTC(y, m, 1)), end: toISO(Date.UTC(y, m + 1, 0)) };
}

/**
 * Project a running cash balance over a horizon. Events dated within
 * [asOf, asOf + horizonDays] (both bounds inclusive) are grouped into buckets by
 * `granularity`, ordered ascending. Each bucket applies its net to the running
 * balance (seeded from openingBalance) to give a closingBalance. Buckets with no
 * in-range event are not emitted, but the running balance is continuous across
 * those gaps. minBalance is the smallest bucket closingBalance and minBalanceDate
 * its periodStart; shortfall is true if any bucket closes below zero.
 */
export function projectCashflow(
  openingBalance: Money,
  events: CashflowEvent[],
  opts: { asOf: string; horizonDays: number; granularity: CashflowGranularity },
): CashflowProjection {
  const { asOf, horizonDays, granularity } = opts;
  const startMs = toMs(asOf);
  // Guard an unparseable asOf: NaN comparisons are all false, which would let
  // every event through (the opposite of the intended empty result).
  if (Number.isNaN(startMs)) throw new Error(`projectCashflow: invalid asOf date "${asOf}"`);
  const endMs = startMs + horizonDays * DAY_MS; // inclusive upper bound

  // Group in-range events by bucket start.
  const groups = new Map<string, { start: string; end: string; inflow: Money; outflow: Money }>();
  for (const ev of events) {
    const evMs = toMs(ev.date);
    if (Number.isNaN(evMs) || evMs < startMs || evMs > endMs) continue;
    const { start, end } = bucketKey(ev.date, granularity);
    let g = groups.get(start);
    if (!g) {
      g = { start, end, inflow: 0, outflow: 0 };
      groups.set(start, g);
    }
    if (ev.amount >= 0) g.inflow = round4(g.inflow + ev.amount);
    else g.outflow = round4(g.outflow + ev.amount);
  }

  // ISO date strings sort lexically in chronological order.
  const sortedStarts = [...groups.keys()].sort();

  let running = round4(openingBalance);
  const buckets: CashflowBucket[] = [];
  let minBalance = round4(openingBalance);
  let minBalanceDate: string | null = null;
  let shortfall = false;
  let seen = false;
  for (const start of sortedStarts) {
    const g = groups.get(start)!;
    const inflow = round4(g.inflow);
    const outflow = round4(g.outflow);
    const net = round4(inflow + outflow);
    running = round4(running + net);
    const closingBalance = running;
    buckets.push({ periodStart: g.start, periodEnd: g.end, inflow, outflow, net, closingBalance });
    if (closingBalance < 0) shortfall = true;
    if (!seen || closingBalance < minBalance) {
      minBalance = closingBalance;
      minBalanceDate = g.start;
      seen = true;
    }
  }

  return {
    openingBalance: round4(openingBalance),
    buckets,
    closingBalance: running,
    minBalance,
    minBalanceDate,
    shortfall,
  };
}

/**
 * The average net cash movement per day over the trailing `windowDays` ending at
 * (and including) `asOf` — i.e. the sum of amounts on dates in
 * [asOf - (windowDays - 1), asOf] divided by windowDays, rounded to 4dp. A
 * negative result is a net daily burn. Returns 0 when windowDays <= 0.
 */
export function dailyRunRate(actuals: CashflowEvent[], windowDays: number, asOf: string): Money {
  if (windowDays <= 0) return 0;
  const asOfMs = toMs(asOf);
  const lowerMs = asOfMs - (windowDays - 1) * DAY_MS;
  let sum = 0;
  for (const ev of actuals) {
    const evMs = toMs(ev.date);
    if (Number.isNaN(evMs) || evMs < lowerMs || evMs > asOfMs) continue;
    sum = round4(sum + ev.amount);
  }
  return round4(sum / windowDays);
}

/**
 * Like projectCashflow, but overlays a run-rate as a synthetic daily cash event
 * (amount = runRatePerDay, category "run-rate") on every day of the horizon
 * [asOf, asOf + horizonDays] inclusive, combined with the scheduled events.
 * Useful for stress-testing a schedule against a modelled daily burn. Reuses
 * projectCashflow so bucketing and balance math stay identical.
 */
export function projectWithRunRate(
  openingBalance: Money,
  scheduled: CashflowEvent[],
  runRatePerDay: Money,
  opts: { asOf: string; horizonDays: number; granularity: CashflowGranularity },
): CashflowProjection {
  const synthetic: CashflowEvent[] = [];
  for (let i = 0; i <= opts.horizonDays; i++) {
    synthetic.push({ date: addDays(opts.asOf, i), amount: round4(runRatePerDay), category: "run-rate" });
  }
  return projectCashflow(openingBalance, [...scheduled, ...synthetic], opts);
}
