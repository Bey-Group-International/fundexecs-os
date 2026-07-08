// components/intelligence/ThesisLive.tsx
// Server component for Build › Thesis. Loads real deal signals and sector
// heatmap snapshots for the active org (migration 0058) and renders the Sector
// Heatmap. The Deal Signal Feed lives on /deals/feed (the program-wide feed);
// the signals loaded here are used only as the heatmap's fallback source when
// no pre-aggregated snapshots exist. Best-effort: any failure (no env, no org,
// query error) falls back to empty arrays so the surface degrades to its empty
// states rather than throwing.
import Link from "next/link";
import { SectorHeatmap } from "@/components/intelligence/SectorHeatmap";
import { buildHeatmap } from "@/lib/deal-intelligence";
import type {
  DealSignal,
  HeatmapCell,
  SignalType,
  ActivityLevel,
} from "@/lib/deal-intelligence";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

// Raw row shapes (these tables are not in the generated database types yet).
interface DealSignalRow {
  id: string;
  signal_type: SignalType;
  title: string;
  summary: string | null;
  sector: string | null;
  geography: string | null;
  company_name: string | null;
  deal_size_min: number | null;
  deal_size_max: number | null;
  deal_stage: string | null;
  relevance_score: number | null;
  thesis_match_score: number | null;
  source_url: string | null;
  published_at: string | null;
  read_at: string | null;
  saved_at: string | null;
}

interface HeatmapSnapshotRow {
  sector: string;
  stage: string;
  deal_count: number | null;
  total_value: number | null;
  yoy_change_pct: number | null;
  activity_level: ActivityLevel;
}

function mapSignal(row: DealSignalRow): DealSignal {
  return {
    id: row.id,
    signalType: row.signal_type,
    title: row.title,
    summary: row.summary ?? undefined,
    sector: row.sector ?? undefined,
    geography: row.geography ?? undefined,
    companyName: row.company_name ?? undefined,
    dealSizeMin: row.deal_size_min,
    dealSizeMax: row.deal_size_max,
    dealStage: row.deal_stage ?? undefined,
    relevanceScore: row.relevance_score ?? 0,
    thesisMatchScore: row.thesis_match_score ?? 0,
    sourceUrl: row.source_url ?? undefined,
    publishedAt: row.published_at ?? undefined,
    readAt: row.read_at,
    savedAt: row.saved_at,
  };
}

function mapHeatmapRow(row: HeatmapSnapshotRow): HeatmapCell {
  return {
    sector: row.sector,
    stage: row.stage,
    dealCount: row.deal_count ?? 0,
    totalValue: row.total_value ?? undefined,
    activityLevel: row.activity_level,
    yoyChangePct: row.yoy_change_pct,
  };
}

async function loadThesisData(): Promise<{
  signals: DealSignal[];
  cells: HeatmapCell[];
}> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { signals: [], cells: [] };

    const sb = await createServerClient();

    const [signalRes, heatmapRes] = await Promise.all([
      sb
        .from("deal_signals")
        .select(
          "id, signal_type, title, summary, sector, geography, company_name, deal_size_min, deal_size_max, deal_stage, relevance_score, thesis_match_score, source_url, published_at, read_at, saved_at",
        )
        .eq("organization_id", ctx.orgId)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(200),
      sb
        .from("sector_heatmap_snapshots")
        .select(
          "sector, stage, deal_count, total_value, yoy_change_pct, activity_level",
        )
        .eq("organization_id", ctx.orgId)
        .order("snapshot_date", { ascending: false }),
    ]);

    const signals = ((signalRes.data ?? []) as DealSignalRow[]).map(mapSignal);

    // Prefer pre-aggregated snapshots; otherwise derive the heatmap from the
    // signals themselves so the grid still reflects real activity.
    const snapshotCells = ((heatmapRes.data ?? []) as HeatmapSnapshotRow[]).map(
      mapHeatmapRow,
    );
    const cells = snapshotCells.length > 0 ? snapshotCells : buildHeatmap(signals);

    return { signals, cells };
  } catch {
    return { signals: [], cells: [] };
  }
}

// Stable ordering for stages so the heatmap columns read left→right by maturity
// when these well-known stages are present; unknown stages keep insertion order.
const STAGE_ORDER = [
  "pre_seed",
  "Pre-Seed",
  "seed",
  "Seed",
  "series_a",
  "Series A",
  "series_b",
  "Series B",
  "series_c",
  "Series C",
  "growth",
  "Growth",
  "late_stage",
  "pre_ipo",
];

function orderStages(stages: string[]): string[] {
  return [...stages].sort((a, b) => {
    const ia = STAGE_ORDER.indexOf(a);
    const ib = STAGE_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

export async function ThesisLive() {
  // signals feed the heatmap fallback (buildHeatmap) inside loadThesisData; the
  // Deal Signal Feed itself now lives on /deals/feed, so only cells are used
  // for rendering here.
  const { cells } = await loadThesisData();

  // Derive the heatmap axes from the cells (the loader returns flat cells, not
  // separate sector/stage lists).
  const sectors = Array.from(new Set(cells.map((c) => c.sector))).sort();
  const stages = orderStages(Array.from(new Set(cells.map((c) => c.stage))));

  return (
    <section>
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
          Sector Heatmap
        </p>
        <Link
          href="/deals/feed"
          className="font-mono text-[10px] uppercase tracking-wider text-gold-400 transition hover:text-gold-300"
        >
          Deal Signal Feed →
        </Link>
      </div>
      {cells.length === 0 && (
        <p className="mb-4 text-xs text-fg-muted">
          Activity levels across your target sectors will appear here as deal
          signals accumulate. Add your asset classes and geographies in the
          thesis editor to activate this view.
        </p>
      )}
      <SectorHeatmap cells={cells} sectors={sectors} stages={stages} />
    </section>
  );
}
