// Execute-hub capital events: the fund's cash ledger. Rolls the raw capital
// events into the position operators and LPs track — paid-in vs returned, net to
// LPs, fees and carry — plus a chronological ledger carrying a running net so
// every call and distribution reads in the context of what came before.
import * as React from "react";
import { createServerClient } from "@/lib/supabase/server";
import { num } from "@/lib/format";
import type { CapitalEvent, Fund } from "@/lib/supabase/database.types";

const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof React.cache === "function" ? React.cache : (fn) => fn;

// Money LPs put in vs money returned to them; fees/carry are deductions shown
// alongside but kept out of the net-to-LP running balance.
const INFLOW = new Set(["capital_call", "contribution"]);
const OUTFLOW = new Set(["distribution", "return_of_capital"]);

export type FlowDirection = "in" | "out" | "cost";

export interface LedgerRow {
  event: CapitalEvent;
  fundName: string | null;
  direction: FlowDirection;
  /** Contribution to the net-to-LP balance: +out, −in, 0 for costs. */
  signed: number;
  /** Net-to-LP balance as of this event (chronological). */
  runningNet: number;
}

export interface TypeBreakdown {
  type: string;
  count: number;
  total: number;
}

export interface CapitalSummary {
  count: number;
  called: number; // paid-in (calls + contributions)
  distributed: number; // returned (distributions + return of capital)
  fees: number;
  carry: number;
  net: number; // distributed − called
  byType: TypeBreakdown[];
  ledger: LedgerRow[]; // chronological ascending, each with running net
  upcoming: { amount: number; date: string; fundName: string | null } | null;
  lastActivity: string | null;
}

export function directionOf(type: string): FlowDirection {
  if (INFLOW.has(type)) return "in";
  if (OUTFLOW.has(type)) return "out";
  return "cost";
}

/**
 * Pure roll-up: aggregate the events into the capital position, a per-type
 * breakdown, and a chronological ledger with a running net. No I/O.
 */
export function rollupCapitalEvents(events: CapitalEvent[], funds: Fund[]): CapitalSummary {
  const fundName = new Map(funds.map((f) => [f.id, f.name]));

  let called = 0;
  let distributed = 0;
  let fees = 0;
  let carry = 0;
  const typeMap = new Map<string, TypeBreakdown>();

  for (const e of events) {
    const amt = num(e.amount);
    const dir = directionOf(e.event_type);
    if (dir === "in") called += amt;
    else if (dir === "out") distributed += amt;
    else if (e.event_type === "fee") fees += amt;
    else if (e.event_type === "carry") carry += amt;

    const t = typeMap.get(e.event_type) ?? { type: e.event_type, count: 0, total: 0 };
    t.count += 1;
    t.total += amt;
    typeMap.set(e.event_type, t);
  }

  // Chronological ledger with a running net-to-LP balance.
  const asc = [...events].sort((a, b) => (a.effective_date < b.effective_date ? -1 : a.effective_date > b.effective_date ? 1 : 0));
  let running = 0;
  const ledger: LedgerRow[] = asc.map((e) => {
    const amt = num(e.amount);
    const direction = directionOf(e.event_type);
    const signed = direction === "out" ? amt : direction === "in" ? -amt : 0;
    running += signed;
    return {
      event: e,
      fundName: fundName.get(e.fund_id) ?? null,
      direction,
      signed,
      runningNet: running,
    };
  });

  // Next capital call coming due.
  const today = new Date().toISOString().slice(0, 10);
  let upcoming: CapitalSummary["upcoming"] = null;
  for (const e of events) {
    if (e.event_type !== "capital_call") continue;
    const due = e.due_date ?? e.effective_date;
    if (!due || due < today) continue;
    if (!upcoming || due < upcoming.date) {
      upcoming = { amount: num(e.amount), date: due, fundName: fundName.get(e.fund_id) ?? null };
    }
  }

  const byType = [...typeMap.values()].sort((a, b) => b.total - a.total);
  const lastActivity = asc.length ? asc[asc.length - 1].effective_date : null;

  return {
    count: events.length,
    called,
    distributed,
    fees,
    carry,
    net: distributed - called,
    byType,
    ledger,
    upcoming,
    lastActivity,
  };
}

/** Compute the Execute-hub capital position for an org (events + funds). */
export const getExecuteCapital = cache(async function getExecuteCapital(
  orgId: string,
): Promise<CapitalSummary> {
  const supabase = createServerClient();
  const [eventsRes, fundsRes] = await Promise.all([
    supabase.from("capital_events").select("*").eq("organization_id", orgId),
    supabase.from("funds").select("*").eq("organization_id", orgId),
  ]);
  return rollupCapitalEvents(
    (eventsRes.data ?? []) as CapitalEvent[],
    (fundsRes.data ?? []) as Fund[],
  );
});
