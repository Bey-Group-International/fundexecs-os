import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getCommandCenterData, type CommandCenterData } from '@/lib/queries/command-center';
import { getFundProfile, type FundProfile } from '@/lib/queries/fund-profile';
import {
  computeLifecycleStageResult,
  computeReadinessScore,
  LIFECYCLE_STAGE_LABELS,
  type LifecycleInputs,
  type LifecycleStage,
  type ReadinessDimensionScore
} from '@/lib/lifecycle';

/* ============================================================================
 * lib/queries/dashboard/lifecycle.ts — the lifecycle-aware Dashboard payload.
 *
 * `getDashboardData(orgId)` composes the existing loaders (Command Center,
 * Fund Profile, Chain of Trust, allocations) into one payload the lifecycle-
 * aware Dashboard binds to. It does NOT re-query what `getCommandCenterData`
 * already fetched — KPIs and warm-connection rollups are reused. The lifecycle
 * stage + readiness score are derived by the pure engine in `lib/lifecycle.ts`.
 *
 * Emergent's high-fidelity dashboard can pull exactly what each section needs:
 *  - hero / stage rail        → `stage`, `stageLabel`, `loopProgress`
 *  - readiness gauge          → `readinessScore`, `readinessBreakdown`
 *  - stage-appropriate tiles  → `stageKpis`
 *  - raise progress bar       → `raiseProgress`
 *  - Earn's next best actions  → `topActions`
 *
 * SEAM (capital_stack_summary): `raiseProgress` currently rolls up the live
 * `allocations` table. When Codex's `capital_stack_summary` lands on main,
 * swap `loadRaiseProgress` to read it — the return shape is the contract and
 * should not change. Do NOT import that table here until it exists on main.
 * ========================================================================= */

/** A stage-appropriate KPI tile. Numbers + a formatted label, UI-agnostic. */
export interface StageKpi {
  /** Stable key for React keys + analytics. */
  key: string;
  /** Display label, e.g. "Pipeline value". */
  label: string;
  /** Raw numeric value (UI formats it). */
  value: number;
  /** 'money' | 'count' | 'percent' — hints the UI how to format `value`. */
  format: 'money' | 'count' | 'percent';
  /** Optional one-line context under the tile. */
  hint?: string;
}

/** Raise progress rolled up for the raise-progress bar. */
export interface RaiseProgress {
  /** Target raise in dollars (0 when unsized). */
  target: number;
  /** Soft-circled capital in dollars. */
  softCircled: number;
  /** Committed/closed capital in dollars. */
  committed: number;
  /** committed / target, 0–100 (0 when no target). */
  committedPct: number;
  /** (committed + softCircled) / target, 0–100 (0 when no target). */
  coveragePct: number;
  /**
   * Where these numbers came from — lets the UI badge "live" vs "summary"
   * and makes the capital_stack_summary swap explicit.
   */
  source: 'allocations' | 'capital_stack_summary';
}

/** An Earn next-best-action card. Mirrors the UI's `NextBestAction` shape. */
export interface DashboardAction {
  id: string;
  title: string;
  context: string;
  cta: string;
  href: string;
  tone: 'azure' | 'gold' | 'success' | 'warning';
}

/** The full lifecycle-aware Dashboard payload. */
export interface DashboardData {
  /** Current lifecycle stage (one of the seven). */
  stage: LifecycleStage;
  /** Human label for the stage, e.g. "Source LPs". */
  stageLabel: string;
  /** One-line "what's the job at this stage" blurb. */
  stageBlurb: string;
  /** 0–100 progress through the seven-stage loop. */
  loopProgress: number;

  /** 0–100 institutional-readiness score. */
  readinessScore: number;
  /** Per-dimension breakdown (profile/proof/materials/pipeline/capital). */
  readinessBreakdown: ReadinessDimensionScore[];

  /** Stage-appropriate KPI tiles (the tiles change by stage). */
  stageKpis: StageKpi[];

  /** Raise progress for the progress bar. */
  raiseProgress: RaiseProgress;

  /** Earn's top 3 lifecycle-aware actions. */
  topActions: DashboardAction[];

  /** Fund-profile credibility surfaced on the dashboard side rail. */
  fundProfile: {
    fundName: string;
    completenessScore: number;
    topGapLabels: string[];
  };
}

/* ---------------------------------------------------------------------------
 * Raise progress — allocations rollup (capital_stack_summary seam).
 * ------------------------------------------------------------------------- */

const COMMITTED_STATUSES = new Set(['accepted', 'funded', 'committed', 'closed']);
const SOFT_STATUSES = new Set([
  'soft-circle',
  'soft_circle',
  'softcircle',
  'interested',
  'pending'
]);

/**
 * Roll the org's `allocations` into target/soft-circled/committed totals.
 *
 * SEAM: replace the body with a single read from `capital_stack_summary` once
 * it exists on main, returning the same `RaiseProgress` shape (set
 * `source: 'capital_stack_summary'`). Target falls back to the Fund Profile's
 * `targetRaise` since allocations don't carry a fund-level target.
 */
async function loadRaiseProgress(orgId: string, fundProfile: FundProfile): Promise<RaiseProgress> {
  const supabase = await createClient();
  const { data } = await supabase.from('allocations').select('amount, status').eq('org_id', orgId);

  let committed = 0;
  let softCircled = 0;
  for (const a of (data ?? []) as Array<{ amount: number | null; status: string }>) {
    const amt = a.amount ?? 0;
    const status = (a.status ?? '').toLowerCase();
    if (COMMITTED_STATUSES.has(status)) committed += amt;
    else if (SOFT_STATUSES.has(status)) softCircled += amt;
  }

  const target = fundProfile.targetRaise ?? 0;
  const committedPct = target > 0 ? Math.min(100, Math.round((committed / target) * 100)) : 0;
  const coveragePct =
    target > 0 ? Math.min(100, Math.round(((committed + softCircled) / target) * 100)) : 0;

  return {
    target,
    softCircled,
    committed,
    committedPct,
    coveragePct,
    source: 'allocations'
  };
}

/* ---------------------------------------------------------------------------
 * Lifecycle inputs — derive the engine inputs from composed loaders.
 * ------------------------------------------------------------------------- */

interface TrustProgress {
  truth: number;
  concept: number;
  execution: number;
  work: number;
  hasRecord: boolean;
}

/** Load the org's member-profile Chain-of-Trust layer progress. */
async function loadTrustProgress(
  orgId: string,
  managerUserId: string | null
): Promise<TrustProgress> {
  const empty: TrustProgress = {
    truth: 0,
    concept: 0,
    execution: 0,
    work: 0,
    hasRecord: false
  };
  if (!managerUserId) return empty;

  const supabase = await createClient();
  const { data: rec } = await supabase
    .from('chain_of_trust_records')
    .select('id')
    .eq('org_id', orgId)
    .eq('entity_type', 'member_profile')
    .eq('entity_id', managerUserId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!rec) return empty;

  const { data: layers } = await supabase
    .from('proof_layers')
    .select('layer_name, completion_percentage')
    .eq('chain_record_id', rec.id);

  const pctOf = (name: string) => {
    const m = (layers ?? []).find((l) => (l.layer_name ?? '').toLowerCase().includes(name));
    return Math.max(0, Math.min(100, Math.round(Number(m?.completion_percentage ?? 0))));
  };

  return {
    truth: pctOf('truth'),
    concept: pctOf('concept'),
    execution: pctOf('execution'),
    work: pctOf('work'),
    hasRecord: true
  };
}

interface PipelineSignals {
  total: number;
  contacted: number;
  softCircled: number;
  committed: number;
  inDiligence: number;
  completedDiligenceRuns: number;
}

/**
 * Lightweight pipeline signal counts. Counts deal rows by stage bucket without
 * the full board rollup `getPipelineData` does (we only need counts here).
 */
async function loadPipelineSignals(orgId: string): Promise<PipelineSignals> {
  const supabase = await createClient();
  const [{ data: deals }, { count: dilCount }] = await Promise.all([
    supabase.from('deals').select('stage, status').eq('org_id', orgId),
    supabase
      .from('diligence_runs')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'complete')
  ]);

  const rows = (deals ?? []) as Array<{ stage: string; status: string }>;
  const norm = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-');
  const firstStages = new Set(['visitor', 'prospect', 'target', 'lead']);

  let contacted = 0;
  let softCircled = 0;
  let committed = 0;
  let inDiligence = 0;
  for (const d of rows) {
    const stage = norm(d.stage ?? '');
    if (!firstStages.has(stage) && stage !== '') contacted += 1;
    if (stage === 'soft-circle') softCircled += 1;
    if (stage === 'committed' || stage === 'closed') committed += 1;
    if (stage === 'diligence') inDiligence += 1;
  }

  return {
    total: rows.length,
    contacted,
    softCircled,
    committed,
    inDiligence,
    completedDiligenceRuns: dilCount ?? 0
  };
}

/**
 * Approximate raise-materials readiness from governance objective completion
 * until a dedicated materials model lands. Returns 0–100. Documented seam:
 * swap for a Capital Materials Studio signal in a later wave.
 */
async function loadMaterialsReadiness(orgId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('governance_objectives')
    .select('status, archived_at, deleted_at')
    .eq('org_id', orgId)
    .is('deleted_at', null);

  const rows = (data ?? []) as Array<{ status: string; archived_at: string | null }>;
  const active = rows.filter((r) => !r.archived_at);
  if (active.length === 0) return 0;
  const done = active.filter((r) => {
    const s = (r.status ?? '').toLowerCase();
    return s === 'done' || s === 'complete' || s === 'completed' || s === 'closed';
  }).length;
  return Math.round((done / active.length) * 100);
}

/* ---------------------------------------------------------------------------
 * Stage-appropriate KPIs + actions.
 * ------------------------------------------------------------------------- */

function buildStageKpis(
  stage: LifecycleStage,
  cmd: CommandCenterData,
  fundProfile: FundProfile,
  raise: RaiseProgress,
  pipeline: PipelineSignals
): StageKpi[] {
  // A small per-stage selection so the tile wall changes by stage rather than
  // showing a generic grid (per the spec).
  switch (stage) {
    case 'establish_truth':
    case 'get_raise_ready':
      return [
        {
          key: 'profile-completeness',
          label: 'Profile completeness',
          value: fundProfile.completenessScore,
          format: 'percent',
          hint: 'How much of the Source of Truth an LP can see'
        },
        {
          key: 'open-gaps',
          label: 'Open profile gaps',
          value: fundProfile.gaps.length,
          format: 'count',
          hint: 'Fields an LP would probe'
        },
        {
          key: 'warm-connections',
          label: 'Hot relationships',
          value: cmd.hotRelationshipsCount,
          format: 'count'
        }
      ];
    case 'source_lps':
      return [
        {
          key: 'pipeline-entries',
          label: 'LP pipeline',
          value: pipeline.total,
          format: 'count',
          hint: 'Entries in the LP universe'
        },
        {
          key: 'contacted',
          label: 'In outreach',
          value: pipeline.contacted,
          format: 'count'
        },
        {
          key: 'warm-week',
          label: 'Warm this week',
          value: cmd.warmRelationshipsThisWeek,
          format: 'count'
        }
      ];
    case 'convert_lps':
      return [
        {
          key: 'soft-circled',
          label: 'Soft-circled',
          value: raise.softCircled,
          format: 'money'
        },
        {
          key: 'committed',
          label: 'Committed',
          value: raise.committed,
          format: 'money'
        },
        {
          key: 'coverage',
          label: 'Target coverage',
          value: raise.coveragePct,
          format: 'percent'
        }
      ];
    case 'source_deals':
      return [
        {
          key: 'active-deals',
          label: 'Active deals',
          value: cmd.activeDealsCount,
          format: 'count'
        },
        {
          key: 'in-diligence',
          label: 'In diligence',
          value: pipeline.inDiligence,
          format: 'count'
        },
        {
          key: 'capital-in-motion',
          label: 'Capital in motion',
          value: cmd.capitalInMotion,
          format: 'money'
        }
      ];
    case 'operate':
    case 'prove':
    default:
      return [
        {
          key: 'completed-diligence',
          label: 'Completed diligence',
          value: pipeline.completedDiligenceRuns,
          format: 'count',
          hint: 'IC-ready memos produced'
        },
        {
          key: 'committed',
          label: 'Committed capital',
          value: raise.committed,
          format: 'money'
        },
        {
          key: 'active-deals',
          label: 'Active deals',
          value: cmd.activeDealsCount,
          format: 'count'
        }
      ];
  }
}

/**
 * Earn's top lifecycle-aware actions. Mirrors the existing next-best-action
 * heuristics in the layouts but selects by stage so the guidance matches where
 * the manager is in the loop. Returns up to 3.
 */
function buildTopActions(
  stage: LifecycleStage,
  fundProfile: FundProfile,
  raise: RaiseProgress,
  pipeline: PipelineSignals
): DashboardAction[] {
  const actions: DashboardAction[] = [];

  // Always surface the single most important profile gap when one exists.
  const topGap = fundProfile.gaps[0];
  if (topGap) {
    actions.push({
      id: `fill-${topGap.field}`,
      title: `Fill in your ${topGap.label.toLowerCase()}`,
      context: topGap.reason,
      cta: 'Open Fund Profile',
      href: '/profile',
      tone: 'azure'
    });
  }

  if (stage === 'source_lps') {
    actions.push({
      id: 'expand-lps',
      title: 'Expand your LP roster',
      context: 'Add and qualify more LPs so Earn can match deals faster.',
      cta: 'Open Connections',
      href: '/connections',
      tone: 'azure'
    });
  } else if (stage === 'convert_lps') {
    actions.push({
      id: 'advance-soft-circle',
      title: 'Move warm LPs to soft-circle',
      context:
        raise.target > 0
          ? `You are at ${raise.coveragePct}% of target — push the next commitment.`
          : 'Convert interest into soft-circles to build the stack.',
      cta: 'Open Pipeline',
      href: '/pipeline',
      tone: 'success'
    });
  } else if (stage === 'source_deals') {
    actions.push({
      id: 'advance-diligence',
      title: 'Advance a deal through diligence',
      context: `${pipeline.inDiligence} deal(s) in diligence — unblock the next milestone.`,
      cta: 'Open Pipeline',
      href: '/pipeline',
      tone: 'azure'
    });
  } else if (stage === 'operate' || stage === 'prove') {
    actions.push({
      id: 'audit-trail',
      title: 'Review your audit trail',
      context: 'Make every Earn action and decision reusable and provable.',
      cta: 'Open Trust Center',
      href: '/trust',
      tone: 'success'
    });
  }

  // Earn always offers a workflow as the gold action.
  actions.push({
    id: 'ask-earn',
    title: `Ask Earn: what moves ${LIFECYCLE_STAGE_LABELS[stage].toLowerCase()} forward?`,
    context: 'Get a one-page briefing on your next best move at this stage.',
    cta: 'Open Ask Earn',
    href: '/ask-earn',
    tone: 'gold'
  });

  return actions.slice(0, 3);
}

/* ---------------------------------------------------------------------------
 * Entry point
 * ------------------------------------------------------------------------- */

/**
 * Load the lifecycle-aware Dashboard payload for the given org. Composes the
 * Command Center KPIs, Fund Profile completeness, Chain-of-Trust progress,
 * pipeline signals, and raise rollup, then derives the lifecycle stage +
 * readiness from the pure engine. RLS-scoped; degrades to a sensible zero
 * state rather than throwing.
 */
export async function getDashboardData(orgId: string): Promise<DashboardData> {
  // Compose existing loaders. getFundProfile resolves the manager user id we
  // need for the trust lookup, so it runs first; the rest run in parallel.
  const fundProfile = await getFundProfile(orgId);

  const [cmd, trust, pipeline, materialsReadiness, raiseProgress] = await Promise.all([
    getCommandCenterData(orgId),
    loadTrustProgress(orgId, fundProfile.managerUserId),
    loadPipelineSignals(orgId),
    loadMaterialsReadiness(orgId),
    loadRaiseProgress(orgId, fundProfile)
  ]);

  const inputs: LifecycleInputs = {
    profileCompleteness: fundProfile.completenessScore,
    trust: {
      truth: trust.truth,
      concept: trust.concept,
      execution: trust.execution,
      work: trust.work
    },
    hasTrustRecord: trust.hasRecord,
    materialsReadiness,
    pipeline: {
      total: pipeline.total,
      contacted: pipeline.contacted,
      softCircled: pipeline.softCircled,
      committed: pipeline.committed,
      inDiligence: pipeline.inDiligence
    },
    raise: {
      target: raiseProgress.target,
      softCircled: raiseProgress.softCircled,
      committed: raiseProgress.committed
    },
    hasDeployedCapital: raiseProgress.committed > 0,
    completedDiligenceRuns: pipeline.completedDiligenceRuns
  };

  const stageResult = computeLifecycleStageResult(inputs);
  const readiness = computeReadinessScore(inputs);

  return {
    stage: stageResult.stage,
    stageLabel: stageResult.label,
    stageBlurb: stageResult.blurb,
    loopProgress: stageResult.loopProgress,
    readinessScore: readiness.score,
    readinessBreakdown: readiness.breakdown,
    stageKpis: buildStageKpis(stageResult.stage, cmd, fundProfile, raiseProgress, pipeline),
    raiseProgress,
    topActions: buildTopActions(stageResult.stage, fundProfile, raiseProgress, pipeline),
    fundProfile: {
      fundName: fundProfile.fundName,
      completenessScore: fundProfile.completenessScore,
      topGapLabels: fundProfile.gaps.slice(0, 3).map((g) => g.label)
    }
  };
}
