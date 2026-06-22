// Execute-hub tax allocation — the K-1 view Carta-for-funds leaves to a separate
// fund administrator. Allocates a fund's taxable items for a year across every
// holder by ownership share, and rolls each holder's tax capital account forward
// (beginning → contributions − distributions + allocated income → ending). Pure
// and dependency-free so the agents and the UI run the same math; the server
// fetcher derives the inputs from the live operating record.
import * as React from "react";
import { createServerClient } from "@/lib/supabase/server";
import { num } from "@/lib/format";
import { isExited } from "@/lib/execute-performance";
import type { Asset, CapitalEvent, Commitment, Investor } from "@/lib/supabase/database.types";

const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof React.cache === "function" ? React.cache : (fn) => fn;

export interface TaxItems {
  ordinaryIncome: number; // operating income passed through (NOI etc.)
  interest: number;
  dividends: number;
  shortTermGain: number; // realized gain, holding < 1y
  longTermGain: number; // realized gain, holding ≥ 1y
  expenses: number; // management fees + carry + fund costs (a positive deduction)
}

export interface TaxHolder {
  investorId: string;
  name: string;
  ownershipPct: number; // 0–100, share of fund commitments
  beginningCapital: number; // tax capital at the start of the year
  contributions: number; // capital contributed during the year
  distributions: number; // capital distributed during the year
}

export interface K1Allocation {
  investorId: string;
  name: string;
  ownershipPct: number;
  ordinaryIncome: number;
  interest: number;
  dividends: number;
  shortTermGain: number;
  longTermGain: number;
  expenses: number;
  netAllocated: number; // income items − expenses
  beginningCapital: number;
  contributions: number;
  distributions: number;
  endingCapital: number; // beginning + contributions − distributions + netAllocated
}

export interface TaxAllocation {
  year: number;
  items: TaxItems;
  netTaxable: number; // total income − expenses
  allocations: K1Allocation[];
  holderCount: number;
  endingCapital: number; // sum of holder ending capital
}

export const EMPTY_ITEMS: TaxItems = {
  ordinaryIncome: 0,
  interest: 0,
  dividends: 0,
  shortTermGain: 0,
  longTermGain: 0,
  expenses: 0,
};

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Net taxable income flowing through the partnership: income items − expenses. */
export function netTaxableOf(i: TaxItems): number {
  return round2(i.ordinaryIncome + i.interest + i.dividends + i.shortTermGain + i.longTermGain - i.expenses);
}

/**
 * Split a total across holders proportional to their shares, rounded to cents,
 * with any rounding residual trued up on the largest-share holder so the per-LP
 * lines sum back to the total exactly.
 */
export function splitByShare(total: number, shares: number[]): number[] {
  const sum = shares.reduce((s, x) => s + Math.max(x, 0), 0);
  if (sum <= 0 || shares.length === 0) return shares.map(() => 0);
  const rounded = shares.map((s) => round2((total * Math.max(s, 0)) / sum));
  const residual = round2(total - rounded.reduce((s, x) => s + x, 0));
  if (residual !== 0) {
    let maxI = 0;
    for (let i = 1; i < shares.length; i++) if (shares[i] > shares[maxI]) maxI = i;
    rounded[maxI] = round2(rounded[maxI] + residual);
  }
  return rounded;
}

/**
 * Allocate the fund's taxable items across holders by ownership share and roll
 * each tax capital account forward. Each line item is split independently (so
 * the per-LP lines tie out to the fund totals), then summed into the holder's
 * net allocation and ending capital. No I/O — unit-testable.
 */
export function allocateTaxYear(year: number, items: TaxItems, holders: TaxHolder[]): TaxAllocation {
  const shares = holders.map((h) => h.ownershipPct);
  const ordinary = splitByShare(items.ordinaryIncome, shares);
  const interest = splitByShare(items.interest, shares);
  const dividends = splitByShare(items.dividends, shares);
  const stGain = splitByShare(items.shortTermGain, shares);
  const ltGain = splitByShare(items.longTermGain, shares);
  const expenses = splitByShare(items.expenses, shares);

  const allocations: K1Allocation[] = holders.map((h, i) => {
    const netAllocated = round2(
      ordinary[i] + interest[i] + dividends[i] + stGain[i] + ltGain[i] - expenses[i],
    );
    return {
      investorId: h.investorId,
      name: h.name,
      ownershipPct: h.ownershipPct,
      ordinaryIncome: ordinary[i],
      interest: interest[i],
      dividends: dividends[i],
      shortTermGain: stGain[i],
      longTermGain: ltGain[i],
      expenses: expenses[i],
      netAllocated,
      beginningCapital: round2(h.beginningCapital),
      contributions: round2(h.contributions),
      distributions: round2(h.distributions),
      endingCapital: round2(h.beginningCapital + h.contributions - h.distributions + netAllocated),
    };
  });

  return {
    year,
    items,
    netTaxable: netTaxableOf(items),
    allocations,
    holderCount: allocations.length,
    endingCapital: round2(allocations.reduce((s, a) => s + a.endingCapital, 0)),
  };
}

// Capital flowing in vs back out, by event type — mirrors the capital ledger.
const INFLOW = new Set(["capital_call", "contribution"]);
const OUTFLOW = new Set(["distribution", "return_of_capital"]);

/**
 * Build a year's tax allocation for an org from the live books. Holders and
 * ownership come from the commitments register; contributions/distributions and
 * fund expenses (fees, carry) come from the capital-events ledger scoped to the
 * year; the taxable income pool is estimated from the operating record —
 * portfolio NOI as ordinary income and realized gains on assets exited in the
 * year as long-term capital gain. Estimated, and labeled as such in the UI.
 */
export const getTaxAllocation = cache(async function getTaxAllocation(
  orgId: string,
  year: number,
): Promise<TaxAllocation> {
  const supabase = createServerClient();
  const [commitRes, invRes, eventsRes, assetsRes] = await Promise.all([
    supabase.from("commitments").select("*").eq("organization_id", orgId),
    supabase.from("investors").select("id,name").eq("organization_id", orgId),
    supabase.from("capital_events").select("*").eq("organization_id", orgId).is("archived_at", null),
    supabase.from("assets").select("*").eq("organization_id", orgId).is("archived_at", null),
  ]);

  const commitments = (commitRes.data ?? []) as Commitment[];
  const investors = (invRes.data ?? []) as Pick<Investor, "id" | "name">[];
  const events = (eventsRes.data ?? []) as CapitalEvent[];
  const assets = (assetsRes.data ?? []) as Asset[];
  const nameById = new Map(investors.map((i) => [i.id, i.name]));

  // Ownership share by committed capital (the basis for income allocation).
  const committedBy = new Map<string, number>();
  for (const c of commitments) {
    committedBy.set(c.investor_id, (committedBy.get(c.investor_id) ?? 0) + num(c.committed_amount));
  }
  const totalCommitted = [...committedBy.values()].reduce((s, x) => s + x, 0);

  const yearPrefix = `${year}-`;
  const inYear = (d: string | null | undefined) => !!d && d.slice(0, 5) === yearPrefix;
  const beforeYear = (d: string | null | undefined) => !!d && d.slice(0, 4) < String(year);

  // Per-investor contributions / distributions for the year, and net paid-in
  // before the year as the beginning tax capital. Fund-level events (no
  // investor_id) are spread across holders by ownership share.
  const contribBy = new Map<string, number>();
  const distBy = new Map<string, number>();
  const beginBy = new Map<string, number>();
  let fundContribYear = 0;
  let fundDistYear = 0;
  let fundBeginNet = 0;
  let expenses = 0;

  for (const e of events) {
    const amt = num(e.amount);
    const inflow = INFLOW.has(e.event_type);
    const outflow = OUTFLOW.has(e.event_type);
    if (e.event_type === "fee" || e.event_type === "carry") {
      if (inYear(e.effective_date)) expenses += amt;
      continue;
    }
    if (!inflow && !outflow) continue;
    const signedBegin = inflow ? amt : -amt;
    if (e.investor_id) {
      if (inYear(e.effective_date)) {
        if (inflow) contribBy.set(e.investor_id, (contribBy.get(e.investor_id) ?? 0) + amt);
        else distBy.set(e.investor_id, (distBy.get(e.investor_id) ?? 0) + amt);
      } else if (beforeYear(e.effective_date)) {
        beginBy.set(e.investor_id, (beginBy.get(e.investor_id) ?? 0) + signedBegin);
      }
    } else {
      if (inYear(e.effective_date)) {
        if (inflow) fundContribYear += amt;
        else fundDistYear += amt;
      } else if (beforeYear(e.effective_date)) {
        fundBeginNet += signedBegin;
      }
    }
  }

  // Taxable income pool, estimated from the operating record: held-portfolio NOI
  // as ordinary income, and realized gains on exited assets as long-term capital
  // gain (assets carry no exit-date column, so realized gains are attributed to
  // the current allocation — an estimate the UI labels as such).
  const held = assets.filter((a) => !isExited(a.status));
  const ordinaryIncome = held.reduce((s, a) => s + Math.max(0, num(a.noi)), 0);
  const realizedPool = assets
    .filter((a) => isExited(a.status))
    .reduce((s, a) => s + (num(a.current_value) - num(a.acquisition_cost)), 0);
  const longTermGain = Math.max(0, realizedPool);

  const items: TaxItems = {
    ordinaryIncome,
    interest: 0,
    dividends: 0,
    shortTermGain: 0,
    longTermGain,
    expenses,
  };

  const ids = [...committedBy.keys()];
  const fundShares = ids.map((id) => committedBy.get(id) ?? 0);
  const fundContribSplit = splitByShare(fundContribYear, fundShares);
  const fundDistSplit = splitByShare(fundDistYear, fundShares);
  const fundBeginSplit = splitByShare(fundBeginNet, fundShares);

  const holders: TaxHolder[] = ids
    .map((id, i) => ({
      investorId: id,
      name: nameById.get(id) ?? "Unknown holder",
      ownershipPct: totalCommitted > 0 ? round2(((committedBy.get(id) ?? 0) / totalCommitted) * 100) : 0,
      beginningCapital: round2((beginBy.get(id) ?? 0) + fundBeginSplit[i]),
      contributions: round2((contribBy.get(id) ?? 0) + fundContribSplit[i]),
      distributions: round2((distBy.get(id) ?? 0) + fundDistSplit[i]),
    }))
    .sort((a, b) => b.ownershipPct - a.ownershipPct);

  return allocateTaxYear(year, items, holders);
});
