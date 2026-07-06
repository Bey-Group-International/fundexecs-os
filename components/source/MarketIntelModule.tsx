// components/source/MarketIntelModule.tsx
// Source › Market Intelligence — live data wiring for the PitchBook-style
// deal/investor intelligence directory. Server component: resolves org context,
// reads the investors / deals / funds / partners tables in parallel (RLS-
// enforced, request-scoped client), merges them into one normalized IntelRecord
// set, ranks by relevance, and hands the result to the presentational board.
//
// Every read is best-effort — any failure (no org, query error, exception)
// degrades to an empty board rather than throwing, so the module always renders.
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { buildIntel, rankIntel, type IntelRecord } from "@/lib/market-intel";
import { MarketIntelBoard } from "@/components/source/MarketIntelBoard";

async function loadIntel(): Promise<IntelRecord[]> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return [];
    const orgId = ctx.orgId;

    const supabase = await createServerClient();

    const [investorsRes, dealsRes, fundsRes, partnersRes] = await Promise.all([
      supabase
        .from("investors")
        .select("id, name, investor_type, jurisdiction, aum, pipeline_stage, created_at")
        .eq("organization_id", orgId),
      supabase
        .from("deals")
        .select("id, name, asset_class, geography, target_amount, stage, created_at")
        .eq("organization_id", orgId),
      supabase
        .from("funds")
        .select("id, name, fund_type, target_size, vintage_year, created_at")
        .eq("organization_id", orgId),
      supabase
        .from("partners")
        .select("id, name, partner_type, status, created_at")
        .eq("organization_id", orgId),
    ]);

    const records = buildIntel({
      investors: (investorsRes.data ?? []) as Record<string, unknown>[],
      deals: (dealsRes.data ?? []) as Record<string, unknown>[],
      funds: (fundsRes.data ?? []) as Record<string, unknown>[],
      partners: (partnersRes.data ?? []) as Record<string, unknown>[],
    });

    return rankIntel(records);
  } catch {
    // Best-effort: any failure degrades to the empty state.
    return [];
  }
}

export async function MarketIntelModule() {
  const records = await loadIntel();
  return <MarketIntelBoard records={records} />;
}
