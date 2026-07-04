// Execute-hub cap table: the ownership ledger across every stakeholder in the
// firm's funds — not just LPs, but co-GPs, institutions, family offices, and the
// rest. Rolls the commitments register into per-holder capital accounts
// (committed, called, distributed, unfunded), ownership share, NAV share, and
// the standard multiples — the Carta-style view of who owns what, computed
// natively from the firm's own books.
import * as React from "react";
import { createServerClient } from "@/lib/supabase/server";
import { num } from "@/lib/format";
import type { Commitment, Investor, Fund, Asset } from "@/lib/supabase/database.types";

const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof React.cache === "function" ? React.cache : (fn) => fn;

const HELD_OUT = new Set(["exited", "sold", "realized", "divested", "written_off"]);

export interface CapHolder {
  investorId: string;
  name: string;
  type: string; // investor_type
  committed: number;
  called: number;
  distributed: number;
  unfunded: number; // committed − called
  ownershipPct: number; // committed / total committed × 100
  navShare: number; // ownership × fund NAV
  dpi: number | null; // distributed / called
  tvpi: number | null; // (distributed + navShare) / called
}

export interface CapTypeBreakdown {
  type: string;
  count: number;
  committed: number;
  pct: number; // share of total committed
}

export interface CapTable {
  holders: CapHolder[];
  holderCount: number;
  fundCount: number;
  totalCommitted: number;
  totalCalled: number;
  totalDistributed: number;
  totalUnfunded: number;
  totalNav: number;
  calledPct: number | null; // total called / total committed
  topHolderPct: number; // largest single ownership share (concentration)
  byType: CapTypeBreakdown[];
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Pure roll-up: aggregate the commitments register (one row per holder per
 * fund) into per-holder capital accounts and the firm-wide cap table. NAV is
 * apportioned by committed-capital ownership share. No I/O — unit-testable.
 */
export function rollupCapTable(
  commitments: Commitment[],
  investors: Investor[],
  funds: Fund[],
  totalNav: number,
): CapTable {
  const investorById = new Map(investors.map((i) => [i.id, i]));

  // Aggregate a holder's commitments across every fund they're in.
  const agg = new Map<string, { committed: number; called: number; distributed: number }>();
  const fundsSeen = new Set<string>();
  for (const c of commitments) {
    fundsSeen.add(c.fund_id);
    const a = agg.get(c.investor_id) ?? { committed: 0, called: 0, distributed: 0 };
    a.committed += num(c.committed_amount);
    a.called += num(c.called_amount);
    a.distributed += num(c.distributed_amount);
    agg.set(c.investor_id, a);
  }

  const totalCommitted = [...agg.values()].reduce((s, a) => s + a.committed, 0);
  const totalCalled = [...agg.values()].reduce((s, a) => s + a.called, 0);
  const totalDistributed = [...agg.values()].reduce((s, a) => s + a.distributed, 0);

  const holders: CapHolder[] = [...agg.entries()]
    .map(([investorId, a]) => {
      const inv = investorById.get(investorId);
      const ownershipPct = totalCommitted > 0 ? round2((a.committed / totalCommitted) * 100) : 0;
      const navShare = totalNav * (ownershipPct / 100);
      return {
        investorId,
        name: inv?.name ?? "Unknown holder",
        type: inv?.investor_type ?? "other",
        committed: a.committed,
        called: a.called,
        distributed: a.distributed,
        unfunded: Math.max(0, a.committed - a.called),
        ownershipPct,
        navShare,
        dpi: a.called > 0 ? round2(a.distributed / a.called) : null,
        tvpi: a.called > 0 ? round2((a.distributed + navShare) / a.called) : null,
      };
    })
    .sort((x, y) => y.committed - x.committed);

  // Stakeholder-type breakdown — the "not just LPs" cut.
  const typeMap = new Map<string, { count: number; committed: number }>();
  for (const h of holders) {
    const t = typeMap.get(h.type) ?? { count: 0, committed: 0 };
    t.count += 1;
    t.committed += h.committed;
    typeMap.set(h.type, t);
  }
  const byType: CapTypeBreakdown[] = [...typeMap.entries()]
    .map(([type, t]) => ({
      type,
      count: t.count,
      committed: t.committed,
      pct: totalCommitted > 0 ? round2((t.committed / totalCommitted) * 100) : 0,
    }))
    .sort((a, b) => b.committed - a.committed);

  return {
    holders,
    holderCount: holders.length,
    fundCount: fundsSeen.size,
    totalCommitted,
    totalCalled,
    totalDistributed,
    totalUnfunded: Math.max(0, totalCommitted - totalCalled),
    totalNav,
    calledPct: totalCommitted > 0 ? Math.round((totalCalled / totalCommitted) * 100) : null,
    topHolderPct: holders.length ? holders[0].ownershipPct : 0,
    byType,
  };
}

/** Compute the firm-wide cap table for an org (commitments + investors + NAV). */
export const getCapTable = cache(async function getCapTable(orgId: string): Promise<CapTable> {
  const supabase = await createServerClient();
  const [commitRes, invRes, fundRes, assetRes] = await Promise.all([
    supabase.from("commitments").select("*").eq("organization_id", orgId),
    supabase.from("investors").select("*").eq("organization_id", orgId),
    supabase.from("funds").select("*").eq("organization_id", orgId),
    supabase.from("assets").select("current_value,status").eq("organization_id", orgId),
  ]);

  const assets = (assetRes.data ?? []) as Pick<Asset, "current_value" | "status">[];
  const totalNav = assets
    .filter((a) => !HELD_OUT.has((a.status ?? "").toLowerCase()))
    .reduce((s, a) => s + num(a.current_value), 0);

  return rollupCapTable(
    (commitRes.data ?? []) as Commitment[],
    (invRes.data ?? []) as Investor[],
    (fundRes.data ?? []) as Fund[],
    totalNav,
  );
});
