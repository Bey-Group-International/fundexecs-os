// Unified ownership model — the reconciliation of the firm's two cap tables:
//   • Build (entity ownership): who holds equity in the firm's own vehicles
//     (GP, management company, funds, SPVs) — stakeholders × equity_holdings.
//   • Execute (fund cap table): LP capital accounts — investors × commitments.
//
// A stakeholder linked to an investor (stakeholder.investor_id) is the SAME
// holder in both worlds; this merges them into one position so an LP who also
// holds GP/SPV equity shows up once, with both sides. This is the canonical
// holder identity the rest of the app can consolidate onto — and a complete
// ownership picture Carta keeps in two separate products.
import * as React from "react";
import { createServerClient } from "@/lib/supabase/server";
import { num } from "@/lib/format";
import type {
  Stakeholder,
  EquityHolding,
  Entity,
  Commitment,
  Investor,
} from "@/lib/supabase/database.types";

const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof React.cache === "function" ? React.cache : (fn) => fn;

export interface EquityPosition {
  entityId: string;
  entityName: string;
  units: number | null;
  ownershipPct: number | null;
  invested: number;
}

export interface FundAccount {
  committed: number;
  called: number;
  distributed: number;
}

export interface UnifiedHolder {
  key: string; // stakeholder id, or `inv:<id>` for an unlinked investor
  stakeholderId: string | null;
  investorId: string | null;
  name: string;
  kind: string; // stakeholder kind, else investor type
  equity: EquityPosition[];
  equityInvested: number;
  fund: FundAccount | null;
  hasEquity: boolean;
  hasFund: boolean;
  linked: boolean; // appears in BOTH worlds — the reconciliation payoff
}

export interface UnifiedOwnership {
  holders: UnifiedHolder[];
  holderCount: number;
  linkedCount: number; // hold both fund commitments AND firm equity
  equityOnly: number;
  fundOnly: number;
  totalEquityInvested: number;
  totalCommitted: number;
}

/**
 * Pure merge: stakeholders + equity holdings + fund commitments → one holder
 * list keyed on the canonical identity. Investors with commitments but no
 * linked stakeholder still appear (fund-only). No I/O — unit-testable.
 */
export function unifyOwnership(
  stakeholders: Stakeholder[],
  holdings: EquityHolding[],
  entities: Pick<Entity, "id" | "name">[],
  commitments: Commitment[],
  investors: Pick<Investor, "id" | "name" | "investor_type">[],
): UnifiedOwnership {
  const entityName = new Map(entities.map((e) => [e.id, e.name]));
  const investorById = new Map(investors.map((i) => [i.id, i]));

  const equityByStake = new Map<string, EquityPosition[]>();
  for (const h of holdings) {
    const list = equityByStake.get(h.stakeholder_id) ?? [];
    list.push({
      entityId: h.entity_id,
      entityName: entityName.get(h.entity_id) ?? "—",
      units: h.units,
      ownershipPct: h.ownership_pct,
      invested: num(h.invested_amount),
    });
    equityByStake.set(h.stakeholder_id, list);
  }

  const fundByInvestor = new Map<string, FundAccount>();
  for (const c of commitments) {
    const a = fundByInvestor.get(c.investor_id) ?? { committed: 0, called: 0, distributed: 0 };
    a.committed += num(c.committed_amount);
    a.called += num(c.called_amount);
    a.distributed += num(c.distributed_amount);
    fundByInvestor.set(c.investor_id, a);
  }

  const holders: UnifiedHolder[] = [];
  const usedInvestors = new Set<string>();

  for (const s of stakeholders) {
    const equity = equityByStake.get(s.id) ?? [];
    const fund = s.investor_id ? fundByInvestor.get(s.investor_id) ?? null : null;
    if (s.investor_id && fund) usedInvestors.add(s.investor_id);
    const hasEquity = equity.length > 0;
    const hasFund = fund != null;
    if (!hasEquity && !hasFund) continue; // a bare stakeholder isn't a holder yet
    holders.push({
      key: s.id,
      stakeholderId: s.id,
      investorId: s.investor_id,
      name: s.name,
      kind: s.kind,
      equity,
      equityInvested: equity.reduce((t, e) => t + e.invested, 0),
      fund,
      hasEquity,
      hasFund,
      linked: hasEquity && hasFund,
    });
  }

  // Investors holding commitments with no linked stakeholder — fund-only holders.
  for (const [investorId, fund] of fundByInvestor) {
    if (usedInvestors.has(investorId)) continue;
    const inv = investorById.get(investorId);
    holders.push({
      key: `inv:${investorId}`,
      stakeholderId: null,
      investorId,
      name: inv?.name ?? "Unknown holder",
      kind: inv?.investor_type ?? "other",
      equity: [],
      equityInvested: 0,
      fund,
      hasEquity: false,
      hasFund: true,
      linked: false,
    });
  }

  // Linked first (the reconciled holders), then by total economic footprint.
  holders.sort((a, b) => {
    if (a.linked !== b.linked) return a.linked ? -1 : 1;
    const av = a.equityInvested + (a.fund?.committed ?? 0);
    const bv = b.equityInvested + (b.fund?.committed ?? 0);
    return bv - av;
  });

  return {
    holders,
    holderCount: holders.length,
    linkedCount: holders.filter((h) => h.linked).length,
    equityOnly: holders.filter((h) => h.hasEquity && !h.hasFund).length,
    fundOnly: holders.filter((h) => h.hasFund && !h.hasEquity).length,
    totalEquityInvested: holders.reduce((t, h) => t + h.equityInvested, 0),
    totalCommitted: holders.reduce((t, h) => t + (h.fund?.committed ?? 0), 0),
  };
}

/** Compute the unified ownership picture for an org. */
export const getUnifiedOwnership = cache(async function getUnifiedOwnership(
  orgId: string,
): Promise<UnifiedOwnership> {
  const supabase = await createServerClient();
  const [stakeRes, holdRes, entRes, commitRes, invRes] = await Promise.all([
    supabase.from("stakeholders").select("*").eq("organization_id", orgId),
    supabase.from("equity_holdings").select("*").eq("organization_id", orgId),
    supabase.from("entities").select("id,name").eq("organization_id", orgId),
    supabase.from("commitments").select("*").eq("organization_id", orgId),
    supabase.from("investors").select("id,name,investor_type").eq("organization_id", orgId),
  ]);
  return unifyOwnership(
    (stakeRes.data ?? []) as Stakeholder[],
    (holdRes.data ?? []) as EquityHolding[],
    (entRes.data ?? []) as Pick<Entity, "id" | "name">[],
    (commitRes.data ?? []) as Commitment[],
    (invRes.data ?? []) as Pick<Investor, "id" | "name" | "investor_type">[],
  );
});
