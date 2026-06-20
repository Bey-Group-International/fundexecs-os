// lib/source-readiness.ts
// Source-hub momentum: turns the pipelines and relationships a firm is building
// (LPs, debt, partners, providers, deals) into a single forward-looking signal,
// the way Build › readiness does for the foundation. Two anchors operators
// actually steer by:
//   • Capital coverage — circled + committed capital against the raise target.
//   • Velocity — how much of the live pipeline has gone quiet (stalled).
// Both compound: every name added, every stage advanced, moves a visible meter
// and resurfaces the single next-best move.
import { createServerClient } from "@/lib/supabase/server";
import { stageToTemperature } from "@/lib/capital-map";
import type {
  Investor,
  Deal,
  Partner,
  ServiceProvider,
  DebtFacility,
  Fund,
  InvestmentThesis,
} from "@/lib/supabase/database.types";

export type SourceModuleStatus = "empty" | "started" | "complete";

export interface SourceModuleChip {
  key: string;
  label: string;
  href: string;
  count: number;
  status: SourceModuleStatus;
}

export interface CapitalCoverage {
  /** Target raise (Σ fund target sizes). 0 when none is set yet. */
  target: number;
  /** Equity that is committed or actively circling. */
  equity: number;
  /** Debt that is committed or drawn. */
  debt: number;
  /** Combined capital stack (equity + debt) lined up against the target. */
  stack: number;
  /** 0–100 coverage, or null when no target has been set. */
  pct: number | null;
}

export interface PipelineVelocity {
  /** Live relationships/deals (not cold, not terminal). */
  active: number;
  /** Live items with no activity in the staleness window. */
  stalled: number;
  /** Age in days of the most stale live item, if any. */
  oldestDays: number | null;
}

export interface SourceStage {
  key: string;
  label: string;
  threshold: number;
  blurb: string;
  unlocked: boolean;
  current: boolean;
}

export interface SourceNextAction {
  label: string;
  href: string;
  moduleLabel: string;
}

export interface SourceMomentum {
  overall: number;
  stage: SourceStage;
  stages: SourceStage[];
  coverage: CapitalCoverage;
  velocity: PipelineVelocity;
  modules: SourceModuleChip[];
  nextAction: SourceNextAction | null;
}

const STALE_DAYS = 21;
const DEAL_DEAD = new Set(["passed", "dead", "exited"]);
const DEAL_LIVE = new Set([
  "sourced",
  "screening",
  "diligence",
  "underwriting",
  "ic_review",
  "closing",
]);

const num = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function checkEstimate(inv: Investor): number {
  const lo = inv.typical_check_min;
  const hi = inv.typical_check_max;
  if (lo != null && hi != null) return (lo + hi) / 2;
  return hi ?? lo ?? 0;
}

function ageInDays(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / 86_400_000);
}

function chip(
  key: string,
  label: string,
  count: number,
): SourceModuleChip {
  const status: SourceModuleStatus = count === 0 ? "empty" : count >= 3 ? "complete" : "started";
  return { key, label, href: `/source/${key}`, count, status };
}

const STAGE_DEFS: Omit<SourceStage, "unlocked" | "current">[] = [
  { key: "prospecting", label: "Prospecting", threshold: 0, blurb: "Filling the top of the funnel." },
  {
    key: "building",
    label: "Building Pipeline",
    threshold: 30,
    blurb: "Real names across LPs, deals, and the bench.",
  },
  {
    key: "circling",
    label: "Circling Capital",
    threshold: 60,
    blurb: "Capital is moving — conversations are turning into soft circles.",
  },
  {
    key: "closing",
    label: "Closing",
    threshold: 85,
    blurb: "Commitments landing against the target with a deep bench behind them.",
  },
];

/**
 * Compute Source-hub momentum for an org. Pulls the pipeline tables in parallel
 * and rolls them into coverage, velocity, per-module presence, and the single
 * next-best move.
 */
export async function getSourceMomentum(orgId: string): Promise<SourceMomentum> {
  const supabase = createServerClient();

  // Momentum reflects the live pipeline — archived records are excluded.
  const [invRes, dealRes, partRes, provRes, debtRes, fundRes, thesisRes] = await Promise.all([
    supabase.from("investors").select("*").eq("organization_id", orgId).is("archived_at", null),
    supabase.from("deals").select("*").eq("organization_id", orgId).is("archived_at", null),
    supabase.from("partners").select("*").eq("organization_id", orgId).is("archived_at", null),
    supabase.from("service_providers").select("*").eq("organization_id", orgId).is("archived_at", null),
    supabase.from("debt_facilities").select("*").eq("organization_id", orgId).is("archived_at", null),
    supabase.from("funds").select("*").eq("organization_id", orgId),
    supabase.from("investment_theses").select("*").eq("organization_id", orgId),
  ]);

  const investors = (invRes.data ?? []) as Investor[];
  const deals = (dealRes.data ?? []) as Deal[];
  const partners = (partRes.data ?? []) as Partner[];
  const providers = (provRes.data ?? []) as ServiceProvider[];
  const debt = (debtRes.data ?? []) as DebtFacility[];
  const funds = (fundRes.data ?? []) as Fund[];
  const theses = (thesisRes.data ?? []) as InvestmentThesis[];
  const hasMandate = theses.some((t) => t.is_active) || theses.length > 0;

  // --- Capital coverage -----------------------------------------------------
  const target = funds.reduce((s, f) => s + num(f.target_size), 0);
  const equityFromFunds = funds.reduce((s, f) => s + num(f.committed_capital), 0);
  const investorTemps = investors.map((i) => stageToTemperature(i.pipeline_stage || "prospect"));
  const equityCircling = investors.reduce(
    (s, inv, i) =>
      investorTemps[i] === "active" || investorTemps[i] === "committed" ? s + checkEstimate(inv) : s,
    0,
  );
  const equity = Math.max(equityFromFunds, equityCircling);
  const debtCommitted = debt.reduce(
    (s, f) => (/committed|drawn/.test(f.status.toLowerCase()) ? s + num(f.commitment_amount) : s),
    0,
  );
  const stack = equity + debtCommitted;
  const coverage: CapitalCoverage = {
    target,
    equity,
    debt: debtCommitted,
    stack,
    pct: target > 0 ? Math.min(100, Math.round((stack / target) * 100)) : null,
  };

  // --- Velocity -------------------------------------------------------------
  // Live = warm/active LPs + non-terminal deals. Stalled = live but untouched
  // beyond the staleness window.
  const liveItems: { age: number }[] = [];
  investors.forEach((inv, i) => {
    const t = investorTemps[i];
    if (t === "warm" || t === "active") liveItems.push({ age: ageInDays(inv.updated_at) });
  });
  deals.forEach((d) => {
    if (DEAL_LIVE.has(d.stage)) liveItems.push({ age: ageInDays(d.updated_at) });
  });
  const stalledItems = liveItems.filter((x) => x.age >= STALE_DAYS);
  const velocity: PipelineVelocity = {
    active: liveItems.length,
    stalled: stalledItems.length,
    oldestDays: stalledItems.length ? Math.max(...stalledItems.map((x) => x.age)) : null,
  };

  // --- Per-module presence --------------------------------------------------
  const modules: SourceModuleChip[] = [
    chip("lp_pipeline", "LP Pipeline", investors.length),
    chip("debt", "Debt & Hybrid", debt.length),
    chip("partners", "Partners", partners.length),
    chip("providers", "Providers", providers.length),
    chip("deal_pipeline", "Deal Pipeline", deals.length),
  ];

  // --- Overall score --------------------------------------------------------
  // Blend of breadth (is every pipeline populated?), capital coverage, and
  // momentum (how much of the live pipeline is still warm).
  const breadthPart = (modules.filter((m) => m.count > 0).length / modules.length) * 100;
  const coveragePart =
    coverage.pct != null ? coverage.pct : equityCircling > 0 || debtCommitted > 0 ? 40 : 0;
  const momentumPart =
    velocity.active > 0
      ? Math.round((1 - velocity.stalled / velocity.active) * 100)
      : modules.some((m) => m.count > 0)
        ? 50
        : 0;
  const overall = Math.round(0.35 * breadthPart + 0.4 * coveragePart + 0.25 * momentumPart);

  const stages: SourceStage[] = STAGE_DEFS.map((s) => ({
    ...s,
    unlocked: overall >= s.threshold,
    current: false,
  }));
  const currentStage = [...stages].reverse().find((s) => s.unlocked) ?? stages[0];
  currentStage.current = true;

  // --- Next best action -----------------------------------------------------
  // Walk the highest-leverage gaps in operator order: a mandate to source
  // against, then names in the funnel, then re-engagement, then the bench.
  let nextAction: SourceNextAction | null = null;
  const set = (label: string, href: string, moduleLabel: string) => {
    if (!nextAction) nextAction = { label, href, moduleLabel };
  };
  if (!hasMandate) {
    set("Define your thesis so sourcing has a mandate", "/build/thesis", "Thesis");
  } else if (investors.length === 0 && deals.length === 0) {
    set("Add your first LP or deal to start the funnel", "/source/lp_pipeline", "LP Pipeline");
  } else if (velocity.stalled > 0) {
    set(
      `Re-engage ${velocity.stalled} stalled ${velocity.stalled === 1 ? "relationship" : "relationships"}`,
      "/source/lp_pipeline",
      "LP Pipeline",
    );
  } else if (investors.length < 5) {
    set("Widen the LP pipeline — aim for 5+ live conversations", "/source/lp_pipeline", "LP Pipeline");
  } else if (deals.length === 0) {
    set("Source your first deal against the mandate", "/source/deal_pipeline", "Deal Pipeline");
  } else if (providers.length === 0) {
    set("Line up legal, audit, and fund admin", "/source/providers", "Providers");
  } else if (partners.length === 0) {
    set("Add co-GPs and operating partners", "/source/partners", "Partners");
  } else if (coverage.pct != null && coverage.pct < 100) {
    set("Push circling LPs to firm commitments", "/source/lp_pipeline", "LP Pipeline");
  }

  return { overall, stage: currentStage, stages, coverage, velocity, modules, nextAction };
}
