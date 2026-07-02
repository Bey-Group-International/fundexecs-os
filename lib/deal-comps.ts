// PitchBook-style comparable transaction analysis.
// Fetches closed/owned deals from the org and computes EV/Revenue and
// EV/EBITDA multiples from their underwriting cases, returning a ranked table
// for the deal war room's "Comps" section.
import { createServerClient } from "@/lib/supabase/server";
import type { Deal, Underwriting } from "@/lib/supabase/database.types";

export interface DealComp {
  id: string;
  name: string;
  sector: string | null;
  asset_class: string | null;
  stage: string;
  ev: number | null;         // enterprise value (entry price / cost basis)
  revenue: number | null;    // from underwriting entry_revenue
  ebitda: number | null;     // from underwriting entry_ebitda
  evRevenue: number | null;  // EV / Revenue
  evEbitda: number | null;   // EV / EBITDA
  isCurrent: boolean;        // true for the deal being viewed
}

function ratio(num: number | null | undefined, den: number | null | undefined): number | null {
  if (!num || !den || den === 0) return null;
  return Math.round((num / den) * 100) / 100;
}

export async function fetchDealComps(
  orgId: string,
  currentDealId: string,
): Promise<DealComp[]> {
  const supabase = createServerClient();

  // Fetch all non-archived deals in active/closed stages
  const { data: deals } = await supabase
    .from("deals")
    .select("id, name, asset_class, stage, target_amount, archived_at")
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .in("stage", ["owned", "closing", "exited", "ic_review", "underwriting"])
    .limit(50);

  if (!deals || deals.length === 0) return [];

  // Fetch underwriting cases: use equity_required as EV proxy and projected multiples
  const dealIds = (deals as { id: string }[]).map((d) => d.id);
  const { data: underwritings } = await supabase
    .from("underwritings")
    .select("deal_id, equity_required, projected_irr, projected_moic, model")
    .eq("organization_id", orgId)
    .in("deal_id", dealIds)
    .is("archived_at", null);

  // Index underwritings by deal — use the first (most recent) per deal
  const uwByDeal = new Map<string, { deal_id: string; equity_required: number | null; projected_irr: number | null; projected_moic: number | null; model: unknown }>();
  for (const uw of (underwritings ?? []) as { deal_id: string; equity_required: number | null; projected_irr: number | null; projected_moic: number | null; model: unknown }[]) {
    if (!uwByDeal.has(uw.deal_id)) uwByDeal.set(uw.deal_id, uw);
  }

  const comps: DealComp[] = (deals as (Deal & { target_amount: number | null })[]).map((deal) => {
    const uw = uwByDeal.get(deal.id);
    const model = (uw?.model ?? {}) as Record<string, number | null>;
    const ev = uw?.equity_required ?? deal.target_amount ?? null;
    const revenue = model.revenue ?? null;
    const ebitda = model.ebitda ?? null;
    return {
      id: deal.id,
      name: deal.name,
      sector: null,
      asset_class: deal.asset_class ?? null,
      stage: deal.stage,
      ev,
      revenue,
      ebitda,
      evRevenue: ratio(ev, revenue),
      evEbitda: ratio(ev, ebitda),
      isCurrent: deal.id === currentDealId,
    };
  });

  // Current deal first, then sorted by EV descending
  return comps.sort((a, b) => {
    if (a.isCurrent) return -1;
    if (b.isCurrent) return 1;
    return (b.ev ?? 0) - (a.ev ?? 0);
  });
}
