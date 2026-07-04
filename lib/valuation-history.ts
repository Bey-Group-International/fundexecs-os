// Execute-hub valuation history: the audit trail of fair-value marks. Every mark
// recorded on a holding is kept (valuation_marks), so the portfolio's value over
// time is reconstructable, not just its latest number. Native — no dependency.
import { createServerClient } from "@/lib/supabase/server";
import type { ValuationMark } from "@/lib/supabase/database.types";

export interface AssetMarkSummary {
  assetId: string;
  count: number;
  latest: ValuationMark | null;
  first: ValuationMark | null;
}

/** Pure: group marks by asset, newest first, with first/latest per asset. */
export function summarizeMarks(marks: ValuationMark[]): Map<string, AssetMarkSummary> {
  const byAsset = new Map<string, ValuationMark[]>();
  for (const m of marks) {
    (byAsset.get(m.asset_id) ?? byAsset.set(m.asset_id, []).get(m.asset_id)!).push(m);
  }
  const out = new Map<string, AssetMarkSummary>();
  for (const [assetId, list] of byAsset) {
    const sorted = [...list].sort((a, b) => (a.as_of < b.as_of ? 1 : a.as_of > b.as_of ? -1 : 0));
    out.set(assetId, {
      assetId,
      count: sorted.length,
      latest: sorted[0] ?? null,
      first: sorted[sorted.length - 1] ?? null,
    });
  }
  return out;
}

/** Fetch an org's valuation marks, newest first. */
export async function getValuationMarks(orgId: string): Promise<ValuationMark[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("valuation_marks")
    .select("*")
    .eq("organization_id", orgId)
    .order("as_of", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []) as ValuationMark[];
}
