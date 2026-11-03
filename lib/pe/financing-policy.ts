// lib/pe/financing-policy.ts
// The firm's financing limits and covenant monitoring rules (root-financing) as
// numbers, with the labelled standing defaults. Pure. Leverage in x EBITDA,
// headroom thresholds in percent (20 = 20%).

export interface FinancingPolicy {
  maxTotalLeverage?: number;
  maxSeniorLeverage?: number;
  minInterestCoverDownside?: number;
  minEquityPct?: number;
  /** Covenant headroom below this percent raises a warning. */
  covenantWarnHeadroomPct: number;
  /** Headroom below this percent escalates to `escalateTo`. */
  escalateBelowPct?: number;
  escalateTo?: string;
  /** Minimum cash for the 13-week forecast, in the company's currency units. */
  liquidityMinimum?: number;
  /** Call protection longer than this many months is a term the firm resists. */
  maxCallProtectionMonths?: number;
}

/** Standing settings for a generic mid-market buyout fund. NOT any firm's numbers. */
export const DEFAULT_FINANCING: FinancingPolicy = { maxSeniorLeverage: 4.0, covenantWarnHeadroomPct: 20 };

const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Defensive parse. Returns null when nothing usable survives. Never throws. */
export function parseFinancingPolicy(raw: unknown): FinancingPolicy | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const warn = pos(o.covenantWarnHeadroomPct);
  const pct = (v: unknown) => {
    const n = pos(v);
    return n !== undefined && n <= 100 ? n : undefined;
  };
  const p: FinancingPolicy = {
    maxTotalLeverage: pos(o.maxTotalLeverage),
    maxSeniorLeverage: pos(o.maxSeniorLeverage),
    minInterestCoverDownside: pos(o.minInterestCoverDownside),
    minEquityPct: pct(o.minEquityPct),
    covenantWarnHeadroomPct: warn !== undefined && warn <= 100 ? warn : DEFAULT_FINANCING.covenantWarnHeadroomPct,
    escalateBelowPct: pct(o.escalateBelowPct),
    escalateTo: str(o.escalateTo),
    liquidityMinimum: pos(o.liquidityMinimum),
    maxCallProtectionMonths: pos(o.maxCallProtectionMonths),
  };
  const meaningful = Object.entries(p).some(([k, v]) => v !== undefined && !(k === "covenantWarnHeadroomPct" && warn === undefined));
  return meaningful ? p : null;
}
