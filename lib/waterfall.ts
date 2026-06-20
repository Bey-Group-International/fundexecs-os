// Distribution waterfall & carry engine. A standard European (whole-fund)
// waterfall: return of capital → preferred return → GP catch-up → carry split.
// Pure and dependency-free so the interactive calculator can run it client-side
// and the agents can reason over the same math server-side.

export interface WaterfallTerms {
  prefRate: number; // annual preferred return, e.g. 0.08
  carry: number; // carried interest, e.g. 0.20
  catchUp: number; // GP catch-up rate, e.g. 1.0 (100%) … 0 disables
}

export const DEFAULT_TERMS: WaterfallTerms = { prefRate: 0.08, carry: 0.2, catchUp: 1.0 };

export interface WaterfallTier {
  key: "roc" | "pref" | "catchup" | "carry";
  label: string;
  toLps: number;
  toGp: number;
}

export interface WaterfallResult {
  distribution: number;
  paidIn: number;
  tiers: WaterfallTier[];
  totalToLps: number;
  totalToGp: number;
  lpPct: number; // share of the distribution to LPs
  gpPct: number; // share to GP (carry + catch-up)
}

const clamp0 = (v: number): number => (v > 0 && Number.isFinite(v) ? v : 0);

/**
 * Run a single distribution through the waterfall.
 *
 * @param distribution total cash being distributed
 * @param paidIn       LP paid-in capital (the return-of-capital + pref base)
 * @param years        periods of preferred return accrued (simple, non-compounded)
 */
export function computeWaterfall(
  distribution: number,
  paidIn: number,
  terms: WaterfallTerms = DEFAULT_TERMS,
  years = 1,
): WaterfallResult {
  let remaining = clamp0(distribution);
  const pi = clamp0(paidIn);
  const carry = Math.min(Math.max(terms.carry, 0), 0.99);
  const catchUp = Math.min(Math.max(terms.catchUp, 0), 1);

  // 1) Return of capital — LP gets paid-in back first.
  const roc = Math.min(remaining, pi);
  remaining -= roc;

  // 2) Preferred return — LP earns the hurdle on paid-in before GP shares.
  const prefTarget = pi * clamp0(terms.prefRate) * Math.max(years, 0);
  const pref = Math.min(remaining, prefTarget);
  remaining -= pref;

  // 3) GP catch-up — GP catches up toward carry% of profits (pref + catch-up).
  // Solve cu such that cu = carry/(1-carry) * pref, scaled by the catch-up rate.
  const catchUpTarget = carry < 1 ? (carry / (1 - carry)) * pref * catchUp : 0;
  const cu = Math.min(remaining, catchUpTarget);
  remaining -= cu;

  // 4) Carry split — residual profit split carry / (1 − carry).
  const carryToGp = remaining * carry;
  const carryToLps = remaining - carryToGp;

  const tiers: WaterfallTier[] = [
    { key: "roc", label: "Return of capital", toLps: roc, toGp: 0 },
    { key: "pref", label: "Preferred return", toLps: pref, toGp: 0 },
    { key: "catchup", label: "GP catch-up", toLps: 0, toGp: cu },
    { key: "carry", label: "Carry split", toLps: carryToLps, toGp: carryToGp },
  ];

  const totalToLps = tiers.reduce((s, t) => s + t.toLps, 0);
  const totalToGp = tiers.reduce((s, t) => s + t.toGp, 0);
  const total = totalToLps + totalToGp;

  return {
    distribution: clamp0(distribution),
    paidIn: pi,
    tiers,
    totalToLps,
    totalToGp,
    lpPct: total > 0 ? Math.round((totalToLps / total) * 1000) / 10 : 0,
    gpPct: total > 0 ? Math.round((totalToGp / total) * 1000) / 10 : 0,
  };
}

/** Allocate the LP portion of a distribution across holders by ownership share. */
export function allocateToHolders<T extends { name: string; ownershipPct: number }>(
  totalToLps: number,
  holders: T[],
): { name: string; ownershipPct: number; amount: number }[] {
  return holders.map((h) => ({
    name: h.name,
    ownershipPct: h.ownershipPct,
    amount: totalToLps * (h.ownershipPct / 100),
  }));
}
