// lib/vesting.ts
// Equity vesting schedule engine for employee/founder option & RSU grants on the
// firm's own entities. Models a standard cliff + linear accrual schedule: nothing
// vests before the cliff, the cliff tranche releases at the cliff, then units
// accrue at the chosen frequency (monthly/quarterly/annual) up to the total over
// the vesting term — capped at the grant total at/after full vest.
// Pure and dependency-free so the agents and the UI run the same math.

export type VestingFrequency = "monthly" | "quarterly" | "annual";

export interface Grant {
  totalUnits: number; // total shares/options under the grant
  grantDate: string; // ISO date, e.g. "2024-01-15"
  cliffMonths: number; // months until the cliff (0 = no cliff)
  vestingMonths: number; // total vesting term in months, e.g. 48
  frequency: VestingFrequency; // accrual cadence after the cliff
  strikePrice?: number; // optional option strike (per unit)
}

export interface VestingSummary {
  vested: number;
  unvested: number;
  vestedPct: number; // 0–100, share of total units vested
  fullyVestedOn: string | null; // ISO date the grant fully vests
  nextVestDate: string | null; // ISO date of the next tranche (null once fully vested)
  nextVestUnits: number; // units releasing on nextVestDate (0 once fully vested)
}

export interface ForfeitureResult {
  vestedKept: number; // units the holder keeps (vested as of termination)
  unvestedForfeited: number; // units returned to the pool
  forfeitedPct: number; // 0–100, share of total units forfeited
}

export interface VestingRollup {
  granted: number;
  vested: number;
  unvested: number;
  vestedPct: number; // 0–100, vested share of all granted units
}

const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;
const round0 = (v: number): number => Math.round(v);
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Months per tranche for the given cadence (defaults to 1 = monthly). */
function periodMonths(freq: VestingFrequency): number {
  if (freq === "quarterly") return 3;
  if (freq === "annual") return 12;
  return 1;
}

/**
 * Whole calendar months between two ISO dates (to - from). Day-of-month aware:
 * the count only advances once the day-of-month is reached, so a grant on the
 * 15th vests its next tranche on the 15th. Returns 0 for invalid/backwards dates.
 */
export function monthsBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO);
  const to = new Date(toISO);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return 0;
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return months > 0 ? months : 0;
}

/** Add `months` to an ISO date and return an ISO date string (UTC, day-clamped). */
export function addMonths(fromISO: string, months: number): string {
  const from = new Date(fromISO);
  if (isNaN(from.getTime())) return fromISO;
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth() + Math.round(months);
  const d = from.getUTCDate();
  const target = new Date(Date.UTC(y, m, 1));
  // Clamp the day to the last day of the target month (e.g. Jan 31 + 1mo → Feb 28).
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * Units vested as of a date.
 *
 * Math:
 *   - nothing vests before the cliff
 *   - at the cliff, the cliff tranche (cliffMonths/vestingMonths of total) releases
 *   - thereafter units accrue at `frequency` cadence, linear to the total over
 *     the vesting term
 *   - capped at totalUnits at/after full vest
 */
export function vestedUnits(grant: Grant, asOf: string): number {
  const total = num(grant.totalUnits);
  const vestingMonths = num(grant.vestingMonths);
  const cliffMonths = Math.max(0, num(grant.cliffMonths));
  if (total <= 0 || vestingMonths <= 0) return 0;

  const elapsed = monthsBetween(grant.grantDate, asOf);
  if (elapsed <= 0) return 0;
  if (elapsed < cliffMonths) return 0;
  if (elapsed >= vestingMonths) return round0(total);

  const perMonth = total / vestingMonths;
  const period = periodMonths(grant.frequency);

  // Months that have accrued on-cadence: the last completed tranche boundary
  // at or before `elapsed`. With a cliff, the cliff itself releases its full
  // pro-rata block even if it is not on a tranche boundary.
  const cadenceMonths = Math.floor(elapsed / period) * period;
  const accruedMonths = Math.max(cadenceMonths, cliffMonths > 0 ? cliffMonths : 0);
  const vested = perMonth * Math.min(accruedMonths, vestingMonths);
  return round0(Math.min(vested, total));
}

/** Full vesting picture for a grant as of a date. */
export function vestingSummary(grant: Grant, asOf: string): VestingSummary {
  const total = num(grant.totalUnits);
  const vestingMonths = num(grant.vestingMonths);
  const vested = vestedUnits(grant, asOf);
  const unvested = Math.max(0, round0(total) - vested);
  const vestedPct = total > 0 ? round2((vested / round0(total)) * 100) : 0;

  const fullyVestedOn =
    total > 0 && vestingMonths > 0
      ? addMonths(grant.grantDate, vestingMonths)
      : null;

  let nextVestDate: string | null = null;
  let nextVestUnits = 0;

  if (unvested > 0 && vestingMonths > 0) {
    const cliffMonths = Math.max(0, num(grant.cliffMonths));
    const elapsed = monthsBetween(grant.grantDate, asOf);
    const period = periodMonths(grant.frequency);
    const perMonth = total / vestingMonths;

    if (elapsed < cliffMonths) {
      // Next event is the cliff tranche.
      nextVestDate = addMonths(grant.grantDate, cliffMonths);
      nextVestUnits = round0(Math.min(perMonth * cliffMonths, total));
    } else {
      // Next on-cadence boundary after `elapsed`, capped at the vesting term.
      const nextMonth = Math.min(
        (Math.floor(elapsed / period) + 1) * period,
        vestingMonths,
      );
      nextVestDate = addMonths(grant.grantDate, nextMonth);
      const vestedAtNext = round0(
        Math.min(perMonth * Math.min(nextMonth, vestingMonths), total),
      );
      nextVestUnits = Math.max(0, vestedAtNext - vested);
    }
  }

  return {
    vested,
    unvested,
    vestedPct,
    fullyVestedOn,
    nextVestDate,
    nextVestUnits,
  };
}

/**
 * Termination treatment: the holder keeps whatever has vested as of the
 * termination date; everything unvested is forfeited back to the pool.
 */
export function forfeitOnTermination(
  grant: Grant,
  terminationDate: string,
): ForfeitureResult {
  const total = round0(num(grant.totalUnits));
  const vestedKept = vestedUnits(grant, terminationDate);
  const unvestedForfeited = Math.max(0, total - vestedKept);
  const forfeitedPct = total > 0 ? round2((unvestedForfeited / total) * 100) : 0;
  return { vestedKept, unvestedForfeited, forfeitedPct };
}

/** Roll up many grants into a single option-pool / equity summary as of a date. */
export function rollupVesting(grants: Grant[], asOf: string): VestingRollup {
  const list = grants ?? [];
  let granted = 0;
  let vested = 0;
  for (const g of list) {
    granted += round0(num(g.totalUnits));
    vested += vestedUnits(g, asOf);
  }
  const unvested = Math.max(0, granted - vested);
  const vestedPct = granted > 0 ? round2((vested / granted) * 100) : 0;
  return { granted, vested, unvested, vestedPct };
}
