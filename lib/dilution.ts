// lib/dilution.ts
// Carta-style round / dilution modeling for a Build-hub entity cap table.
// Pure & unit-tested: takes a current ownership snapshot ([{name, pct}]) and a
// proposed round (pre-money, raise, optional new option pool) and returns a
// pro-forma table of every holder's pre %, post %, and delta — plus the new
// investor and a freshly-created option pool as their own rows.

export interface RoundInputs {
  preMoney: number;
  raiseAmount: number;
  newInvestorName?: string;
  /** Target post-money option pool %, 0–100. Created pre-money (dilutes existing). */
  optionPoolPct?: number;
}

export interface ProFormaRow {
  name: string;
  premPct: number;
  postPct: number;
  deltaPct: number;
}

export interface RoundResult {
  rows: ProFormaRow[];
  newInvestorPct: number;
  optionPoolPct: number;
  postMoney: number;
  dilutionFactor: number; // remaining share applied to existing holders (0–1)
}

const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/**
 * Model a financing round against a current ownership snapshot.
 *
 * Math:
 *   postMoney        = preMoney + raiseAmount
 *   newInvestorPct   = raiseAmount / postMoney * 100   (0 if postMoney <= 0)
 *   optionPoolPct    = clamped target post-money pool % (0–100)
 *   remaining        = max(0, 100 − newInvestorPct − optionPoolPct)
 *   existing.postPct = existing.premPct * remaining / 100
 *
 * New investor and option pool are appended as their own rows. deltaPct for
 * those new rows is 0 (they have no pre-round position). All % rounded to 2dp.
 */
export function modelRound(
  current: { name: string; pct: number }[],
  inputs: RoundInputs,
): RoundResult {
  const preMoney = num(inputs.preMoney);
  const raiseAmount = num(inputs.raiseAmount);
  const postMoney = preMoney + raiseAmount;

  const newInvestorPct =
    postMoney > 0 ? round2((raiseAmount / postMoney) * 100) : 0;
  const optionPoolPct = round2(clamp(num(inputs.optionPoolPct), 0, 100));

  const remaining = clamp(100 - newInvestorPct - optionPoolPct, 0, 100);
  const dilutionFactor = remaining / 100;

  const rows: ProFormaRow[] = (current ?? []).map((c) => {
    const premPct = round2(num(c.pct));
    const postPct = round2(premPct * dilutionFactor);
    return {
      name: c.name,
      premPct,
      postPct,
      deltaPct: round2(postPct - premPct),
    };
  });

  if (optionPoolPct > 0) {
    rows.push({
      name: "Option Pool (new)",
      premPct: 0,
      postPct: optionPoolPct,
      deltaPct: 0,
    });
  }

  if (newInvestorPct > 0) {
    rows.push({
      name: inputs.newInvestorName?.trim() || "New Investor",
      premPct: 0,
      postPct: newInvestorPct,
      deltaPct: 0,
    });
  }

  return { rows, newInvestorPct, optionPoolPct, postMoney, dilutionFactor };
}
