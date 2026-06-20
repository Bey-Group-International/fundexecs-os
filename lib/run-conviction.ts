// Run-hub conviction: turns the live evaluation work on a deal (thesis fit,
// underwriting cases, diligence coverage, open risks) into a single go/no-go
// signal per deal and a rolled-up portfolio view. This is what makes the Run
// hub *compound* — every cleared diligence item, every downside case, every
// risk resolved moves a visible conviction meter and surfaces the single
// highest-leverage step to push the strongest deal toward IC.
//
// It also benchmarks the live pipeline against the firm's own mandate and
// realized track record, so each new deal is judged against the standard the
// firm has set for itself rather than in a vacuum.
import * as React from "react";
import { createServerClient } from "@/lib/supabase/server";

// React's per-request `cache` is provided by the Next.js runtime; fall back to
// an identity wrapper outside it (e.g. unit tests) so this module loads anywhere.
const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof React.cache === "function" ? React.cache : (fn) => fn;
import { getMandate, type Mandate } from "@/lib/build-readiness";
import type {
  Deal,
  Underwriting,
  DiligenceItem,
  TrackRecord,
  RiskSeverity,
} from "@/lib/supabase/database.types";

// The working set Run acts on: deals actively being evaluated (post-sourcing,
// pre-close). Sourced deals haven't entered evaluation; owned/exited/passed/
// dead have left it.
const ACTIVE_STAGES = new Set(["screening", "diligence", "underwriting", "ic_review"]);

const DILIGENCE_RESOLVED = new Set(["cleared", "waived"]);
const SEVERE = new Set(["high", "critical"]);

export interface ConvictionCheck {
  label: string;
  done: boolean;
  weight: number;
  /** Imperative phrasing used when this check becomes the next-best action. */
  action: string;
}

export interface ConvictionStage {
  key: "watch" | "building" | "conviction" | "ic_ready";
  label: string;
  /** Tailwind tone classes for the badge (border + text). */
  tone: string;
}

export interface DealConviction {
  deal: Deal;
  score: number; // 0–100, weighted
  stage: ConvictionStage;
  checks: ConvictionCheck[];
  doneCount: number;
  total: number;
  baseCase: Underwriting | null;
  cases: Underwriting[];
  diligence: DiligenceItem[];
  coverage: number; // 0..1 resolved share of diligence items
  openRisks: DiligenceItem[]; // unresolved high/critical findings
  projectedIrr: number | null; // normalized to a percentage
  projectedMoic: number | null;
}

export interface RunBenchmark {
  dealsInEval: number;
  avgPipelineIrr: number | null; // avg base-case IRR across the working set
  targetIrr: number | null; // mandate target
  historicalIrr: number | null; // avg realized gross IRR (track record)
  avgCoverage: number; // 0..1
  openCriticalRisks: number;
  icReadyCount: number;
}

export interface RunConviction {
  overall: number;
  stage: ConvictionStage;
  deals: DealConviction[];
  benchmark: RunBenchmark;
  nextAction: { dealName: string; dealId: string; label: string; href: string } | null;
  mandate: Mandate | null;
}

const STAGES: Record<ConvictionStage["key"], ConvictionStage> = {
  watch: { key: "watch", label: "Watch", tone: "border-line text-fg-muted" },
  building: { key: "building", label: "Building", tone: "border-gold-500/40 text-gold-300" },
  conviction: { key: "conviction", label: "Conviction", tone: "border-status-info/50 text-status-info" },
  ic_ready: { key: "ic_ready", label: "IC-Ready", tone: "border-emerald-400/40 text-emerald-300" },
};

function stageFor(score: number): ConvictionStage {
  if (score >= 85) return STAGES.ic_ready;
  if (score >= 65) return STAGES.conviction;
  if (score >= 35) return STAGES.building;
  return STAGES.watch;
}

// Underwriting IRR/MOIC may be stored either as a fraction (0.18) or a whole
// percent (18). Normalize to a percentage for display and comparison.
export function toPercent(v: number | null): number | null {
  if (v == null) return null;
  return v <= 2 ? Math.round(v * 1000) / 10 : Math.round(v * 10) / 10;
}

const STRESS_SCENARIOS = new Set(["downside", "stress", "bear", "bear_case"]);

// The severity a finding still carries: its residual (post-mitigation) severity
// when one has been set, otherwise its raw severity.
export function effectiveSeverity(d: DiligenceItem): RiskSeverity | null {
  return d.residual_severity ?? d.risk_severity;
}

export function scoreDeal(
  deal: Deal,
  underwritings: Underwriting[],
  diligence: DiligenceItem[],
  mandate: Mandate | null,
): DealConviction {
  const cases = underwritings.filter((u) => u.deal_id === deal.id);
  const items = diligence.filter((d) => d.deal_id === deal.id);

  const baseCase =
    cases.find((u) => u.scenario === "base") ??
    cases.find((u) => /base/i.test(u.name)) ??
    cases[0] ??
    null;
  const hasStress = cases.some((u) => STRESS_SCENARIOS.has(u.scenario));

  const resolved = items.filter((d) => DILIGENCE_RESOLVED.has(d.status));
  const coverage = items.length ? resolved.length / items.length : 0;
  // The severity that still bites is the residual one once a mitigation has been
  // recorded — so writing a mitigation visibly buys conviction back.
  const openRisks = items.filter((d) => {
    const sev = effectiveSeverity(d);
    return !DILIGENCE_RESOLVED.has(d.status) && sev != null && SEVERE.has(sev);
  });

  const projectedIrr = toPercent(baseCase?.projected_irr ?? null);
  const projectedMoic = baseCase?.projected_moic ?? null;
  const meetsReturn = projectedIrr != null && mandate?.targetIrr != null && projectedIrr >= mandate.targetIrr;

  const checks: ConvictionCheck[] = [
    {
      label: "Thesis fit scored",
      done: deal.thesis_fit != null,
      weight: 2,
      action: "Score this deal's fit against the mandate",
    },
    {
      label: "Base case underwritten",
      done: !!baseCase,
      weight: 3,
      action: "Underwrite a base case for this deal",
    },
    {
      label: mandate?.targetIrr != null ? `Clears ${mandate.targetIrr}% target IRR` : "Return target met",
      done: meetsReturn,
      weight: 2,
      action: "Get the base case to clear your target return",
    },
    {
      label: "Downside / stress tested",
      done: hasStress,
      weight: 2,
      action: "Run a downside or stress case",
    },
    {
      label: "Diligence substantially cleared",
      done: items.length > 0 && coverage >= 0.7,
      weight: 3,
      action: "Clear the open diligence items",
    },
    {
      label: "No open critical risk",
      done: items.length > 0 && openRisks.length === 0,
      weight: 2,
      action: "Resolve the open high / critical risks",
    },
  ];

  const total = checks.reduce((s, c) => s + c.weight, 0);
  const earned = checks.reduce((s, c) => s + (c.done ? c.weight : 0), 0);
  const score = total === 0 ? 0 : Math.round((earned / total) * 100);

  // A deal carrying an unresolved high/critical risk is never IC-ready,
  // however high its score — the open risk must clear first.
  const stage = openRisks.length > 0 && score >= 85 ? STAGES.conviction : stageFor(score);

  return {
    deal,
    score,
    stage,
    checks,
    doneCount: checks.filter((c) => c.done).length,
    total: checks.length,
    baseCase,
    cases,
    diligence: items,
    coverage,
    openRisks,
    projectedIrr,
    projectedMoic,
  };
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

/**
 * Pure roll-up: given the raw working set, score each active deal and assemble
 * the portfolio view, benchmark, and next-best action. No I/O — kept separate
 * from the fetch so the conviction logic is unit-testable.
 */
export function rollupRunConviction(
  allDeals: Deal[],
  underwritings: Underwriting[],
  diligence: DiligenceItem[],
  track: TrackRecord[],
  mandate: Mandate | null,
): RunConviction {
  const active = allDeals.filter((d) => ACTIVE_STAGES.has(d.stage));
  const deals = active
    .map((d) => scoreDeal(d, underwritings, diligence, mandate))
    .sort((a, b) => b.score - a.score);

  const overall = deals.length ? Math.round(avg(deals.map((d) => d.score))!) : 0;

  const pipelineIrrs = deals.map((d) => d.projectedIrr).filter((v): v is number => v != null);
  const historicalIrrs = track
    .map((t) => toPercent(t.gross_irr))
    .filter((v): v is number => v != null);
  const benchmark: RunBenchmark = {
    dealsInEval: deals.length,
    avgPipelineIrr: avg(pipelineIrrs),
    targetIrr: mandate?.targetIrr ?? null,
    historicalIrr: avg(historicalIrrs),
    avgCoverage: deals.length ? avg(deals.map((d) => d.coverage))! : 0,
    openCriticalRisks: deals.reduce((s, d) => s + d.openRisks.length, 0),
    icReadyCount: deals.filter((d) => d.stage.key === "ic_ready").length,
  };

  // Next-best step: take the strongest deal not yet IC-ready and surface its
  // first pending check — pushing the closest-to-conviction deal over the line.
  let nextAction: RunConviction["nextAction"] = null;
  const pushable = deals.find((d) => d.stage.key !== "ic_ready" && d.checks.some((c) => !c.done));
  if (pushable) {
    const pending = pushable.checks.find((c) => !c.done)!;
    nextAction = {
      dealName: pushable.deal.name,
      dealId: pushable.deal.id,
      label: pending.action,
      href: "/run/diligence",
    };
  }

  return { overall, stage: stageFor(overall), deals, benchmark, nextAction, mandate };
}

/**
 * Compute Run-hub conviction for an org. Pulls the active deal working set and
 * its underwriting + diligence in parallel, then hands off to the pure roll-up.
 *
 * Memoized per request: the hub layout and the active module both read it, and
 * `cache` collapses that into a single set of queries.
 */
export const getRunConviction = cache(async function getRunConviction(
  orgId: string,
): Promise<RunConviction> {
  const supabase = createServerClient();

  const [dealsRes, uwRes, dilRes, trackRes, mandate] = await Promise.all([
    supabase.from("deals").select("*").eq("organization_id", orgId),
    supabase.from("underwritings").select("*").eq("organization_id", orgId),
    supabase.from("diligence_items").select("*").eq("organization_id", orgId),
    supabase.from("track_records").select("*").eq("organization_id", orgId).eq("is_realized", true),
    getMandate(orgId),
  ]);

  return rollupRunConviction(
    (dealsRes.data ?? []) as Deal[],
    (uwRes.data ?? []) as Underwriting[],
    (dilRes.data ?? []) as DiligenceItem[],
    (trackRes.data ?? []) as TrackRecord[],
    mandate,
  );
});
