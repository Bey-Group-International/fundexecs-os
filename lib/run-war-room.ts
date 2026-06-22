// Run-hub deal war room: everything about one deal's evaluation in a single
// place — its live conviction, the underwriting cases and diligence behind it,
// the risk heatmap, the recorded IC decisions, and the trend of conviction as
// the operator has worked it. This is the drill-down behind every deal chip in
// the Run command center.
import { createServerClient } from "@/lib/supabase/server";
import { getMandate, type Mandate } from "@/lib/build-readiness";
import { scoreDeal, effectiveSeverity, type DealConviction } from "@/lib/run-conviction";
import type {
  Deal,
  Underwriting,
  DiligenceItem,
  IcDecision,
  ConvictionSnapshot,
  RiskSeverity,
} from "@/lib/supabase/database.types";

type Client = ReturnType<typeof createServerClient>;

export interface DealWarRoom {
  conviction: DealConviction;
  decisions: IcDecision[];
  snapshots: ConvictionSnapshot[];
  mandate: Mandate | null;
}

/**
 * Score one deal in isolation: fetch the deal plus its underwriting, diligence,
 * and the firm's mandate, then run the shared per-deal scorer. Returns null if
 * the deal doesn't exist for this org. Used by the war room and by the snapshot
 * writer after every evaluation mutation.
 */
export async function computeDealConviction(
  supabase: Client,
  orgId: string,
  dealId: string,
): Promise<DealConviction | null> {
  const [dealRes, uwRes, dilRes, mandate] = await Promise.all([
    supabase.from("deals").select("*").eq("id", dealId).eq("organization_id", orgId).maybeSingle(),
    supabase
      .from("underwritings")
      .select("*")
      .eq("organization_id", orgId)
      .eq("deal_id", dealId)
      .is("archived_at", null),
    supabase
      .from("diligence_items")
      .select("*")
      .eq("organization_id", orgId)
      .eq("deal_id", dealId)
      .is("archived_at", null),
    getMandate(orgId),
  ]);
  const deal = dealRes.data as Deal | null;
  if (!deal) return null;
  return scoreDeal(deal, (uwRes.data ?? []) as Underwriting[], (dilRes.data ?? []) as DiligenceItem[], mandate);
}

/**
 * Append a conviction snapshot for a deal, but only when the score has actually
 * moved since the last one — so the trend reflects real progress, not write
 * volume. Called from every evaluation mutation; failures are swallowed so a
 * snapshot never blocks the underlying edit.
 */
export async function recordConvictionSnapshot(
  supabase: Client,
  orgId: string,
  dealId: string,
): Promise<void> {
  try {
    const conviction = await computeDealConviction(supabase, orgId, dealId);
    if (!conviction) return;

    const { data: last } = await supabase
      .from("conviction_snapshots")
      .select("score")
      .eq("deal_id", dealId)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (last && (last as { score: number }).score === conviction.score) return;

    await supabase.from("conviction_snapshots").insert({
      organization_id: orgId,
      deal_id: dealId,
      score: conviction.score,
      stage: conviction.stage.key,
    });
  } catch {
    // Snapshotting is best-effort momentum telemetry — never fail the edit on it.
  }
}

/**
 * Assemble the full war room for a deal: its current conviction, the IC decision
 * log (newest first), and the conviction trend (oldest → newest for plotting).
 */
export async function getDealWarRoom(orgId: string, dealId: string): Promise<DealWarRoom | null> {
  const supabase = createServerClient();
  const conviction = await computeDealConviction(supabase, orgId, dealId);
  if (!conviction) return null;

  const [decRes, snapRes, mandate] = await Promise.all([
    supabase
      .from("ic_decisions")
      .select("*")
      .eq("organization_id", orgId)
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false }),
    supabase
      .from("conviction_snapshots")
      .select("*")
      .eq("deal_id", dealId)
      .order("captured_at", { ascending: true }),
    getMandate(orgId),
  ]);

  return {
    conviction,
    decisions: (decRes.data ?? []) as IcDecision[],
    snapshots: (snapRes.data ?? []) as ConvictionSnapshot[],
    mandate,
  };
}

// --- Risk heatmap ----------------------------------------------------------
const SEVERITY_AXIS: RiskSeverity[] = ["low", "medium", "high", "critical"];

export interface HeatCell {
  severity: RiskSeverity; // impact (y)
  likelihood: RiskSeverity; // x
  items: DiligenceItem[];
}

/**
 * Bucket a deal's open findings into a likelihood × severity grid. Findings use
 * their residual (post-mitigation) severity so the heatmap shows where the deal
 * actually stands, and a default 'medium' likelihood when none was recorded.
 */
export function buildHeatmap(items: DiligenceItem[]): HeatCell[][] {
  const open = items.filter((d) => d.status !== "cleared" && d.status !== "waived");
  // grid[severityIndex][likelihoodIndex]; severity high at the top when rendered.
  return SEVERITY_AXIS.map((severity) =>
    SEVERITY_AXIS.map((likelihood) => ({
      severity,
      likelihood,
      items: open.filter(
        (d) => (effectiveSeverity(d) ?? "low") === severity && (d.likelihood ?? "medium") === likelihood,
      ),
    })),
  );
}

export { SEVERITY_AXIS };
