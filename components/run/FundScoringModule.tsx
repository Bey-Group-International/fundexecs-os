// components/run/FundScoringModule.tsx
// Run › Fund Scoring — live data wiring for the ML-style fund-selection scoring
// board. Async server component: resolves org context itself (no props), reads
// the org's funds and track_records (RLS-enforced, request-scoped client),
// scores + ranks each fund with the pure lib/fund-scoring model, and hands the
// view-model rows to the presentational <FundScoringBoard>. Every read is
// best-effort — any failure (no org, query error, exception) degrades to an
// empty board rather than throwing, mirroring components/execute/ClosingLive.tsx.
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import {
  factorsFromFund,
  rankFunds,
  type FundRowLike,
  type TrackRecordRowLike,
  type RankedFund,
} from "@/lib/fund-scoring";
import { FundScoringBoard } from "@/components/run/FundScoringBoard";

// Row shapes read from the two tables. Only the columns the model consumes are
// typed here.
interface FundRow extends FundRowLike {
  currency: string | null;
}

async function loadRankedFunds(): Promise<RankedFund[]> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return [];
    const orgId = ctx.orgId;

    const supabase = await createServerClient();

    const [fundsRes, recordsRes] = await Promise.all([
      supabase
        .from("funds")
        .select(
          "id, name, fund_type, vintage_year, target_size, committed_capital, called_capital, distributed_capital, currency",
        )
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false }),
      supabase
        .from("track_records")
        .select("asset_class, vintage_year, gross_irr, gross_moic, is_realized")
        .eq("organization_id", orgId),
    ]);

    const funds = (fundsRes.data ?? []) as FundRow[];
    const records = (recordsRes.data ?? []) as TrackRecordRowLike[];

    // The org's track record is the GP's prior-performance history — shared
    // across funds as the persistence signal each fund is scored against.
    return rankFunds(
      funds.map((fund) => ({
        id: fund.id,
        name: fund.name,
        factors: factorsFromFund(fund, records),
      })),
    );
  } catch {
    // Best-effort: any failure degrades to the empty state.
    return [];
  }
}

export async function FundScoringModule() {
  const rows = await loadRankedFunds();
  return <FundScoringBoard rows={rows} />;
}
