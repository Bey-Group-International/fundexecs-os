import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

type PlanRow = Database['public']['Tables']['governance_plans']['Row'];
type ObjectiveRow = Database['public']['Tables']['governance_objectives']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export interface StrategyObjective {
  id: string;
  planId: string;
  tier: '100' | '30' | '10';
  title: string;
  timeline: string | null;
  /** Display name of the objective owner, when resolvable. */
  owner: string | null;
  priority: 'High' | 'Medium' | 'Low';
  pct: number;
  read: boolean;
  state: 'open' | 'done' | 'archived';
  ai: string | null;
  // Phase 2b compounding fields — present once the strategy_objective_compounding
  // migration is applied; the loader degrades to safe defaults before then.
  /** Posture lane, or null when uncategorized / pre-migration. */
  category: string | null;
  /** Provenance: manual | signal | lifecycle | cascade. */
  source: string;
  /** Real value-at-stake from a linked deal, when known (hybrid weighting). */
  capitalWeight: number | null;
  /** False while a specialist draft awaits approval; true once live. */
  approved: boolean;
  /** Cascade parent, when this was spawned by a completed objective. */
  parentObjectiveId: string | null;
  /** Lifecycle stage this objective advances. */
  lifecycleStage: string | null;
}

export interface StrategyData {
  planName: string | null;
  objectives: StrategyObjective[];
}

const EMPTY: StrategyData = { planName: null, objectives: [] };

/** Derive the 100 / 30 / 10 tier from a plan horizon or objective timeline. */
function deriveTier(horizon: string | null, timeline: string | null): '100' | '30' | '10' {
  const hay = `${horizon ?? ''} ${timeline ?? ''}`.toLowerCase();
  if (hay.includes('100')) return '100';
  if (hay.includes('30')) return '30';
  if (hay.includes('10')) return '10';
  return '100';
}

function normalizePriority(priority: string): 'High' | 'Medium' | 'Low' {
  const p = priority.toLowerCase();
  if (p === 'high') return 'High';
  if (p === 'low') return 'Low';
  return 'Medium';
}

function normalizeState(status: string, archivedAt: string | null): StrategyObjective['state'] {
  if (archivedAt) return 'archived';
  const s = status.toLowerCase();
  if (s === 'done' || s === 'complete' || s === 'completed' || s === 'closed') return 'done';
  if (s === 'archived') return 'archived';
  return 'open';
}

/** Map a status to an indicative completion percentage when none is stored. */
function statusPct(state: StrategyObjective['state'], status: string): number {
  if (state === 'done') return 100;
  const s = status.toLowerCase();
  if (s === 'in_progress' || s === 'in-progress' || s === 'active') return 50;
  return 0;
}

/** Abbreviate a full name to a "F. Last" form for compact card display. */
function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return full;
  if (parts.length === 1) return parts[0];
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

/**
 * Fetch the org's governance plans and their objectives. RLS-scoped via the
 * server client; any query error degrades to an empty result so the page
 * never throws at render time.
 */
export async function getStrategyData(orgId: string): Promise<StrategyData> {
  const supabase = await createClient();

  const plansRes = await supabase
    .from('governance_plans')
    .select('id, name, horizon, status')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });

  // Try the Phase 2b compounding columns first. Only a genuine "column doesn't
  // exist" (Postgres undefined_column / 42703) means the migration isn't applied
  // — fall back to the legacy shape for that case alone. Any other error (RLS,
  // privilege, transient) must NOT masquerade as "no compounding columns", which
  // would mislabel real pending drafts (source≠manual) as live plan objectives
  // and hide them from the review inbox. So the page is safe both before and
  // after `db push`, and a true DB error degrades to an empty result instead.
  const extended = await supabase
    .from('governance_objectives')
    .select(
      'id, plan_id, objective, timeline, priority, status, read_at, archived_at, ai_recommendation, owner_id, category, capital_weight, source, parent_objective_id, lifecycle_stage, approved_at'
    )
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  const missingCompoundingCols = extended.error?.code === '42703';
  const hasCompoundingCols = !extended.error;
  const objsRes = missingCompoundingCols
    ? await supabase
        .from('governance_objectives')
        .select(
          'id, plan_id, objective, timeline, priority, status, read_at, archived_at, ai_recommendation, owner_id'
        )
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
    : extended;

  if (plansRes.error && objsRes.error) return EMPTY;

  const plans = (plansRes.data ?? []) as Pick<PlanRow, 'id' | 'name' | 'horizon' | 'status'>[];
  const horizonByPlan = new Map(plans.map((p) => [p.id, p.horizon]));

  type ObjSel = Pick<
    ObjectiveRow,
    | 'id'
    | 'plan_id'
    | 'objective'
    | 'timeline'
    | 'priority'
    | 'status'
    | 'read_at'
    | 'archived_at'
    | 'ai_recommendation'
    | 'owner_id'
  > &
    Partial<
      Pick<
        ObjectiveRow,
        | 'category'
        | 'capital_weight'
        | 'source'
        | 'parent_objective_id'
        | 'lifecycle_stage'
        | 'approved_at'
      >
    >;
  const rawObjectives = (objsRes.data ?? []) as unknown as ObjSel[];

  // Resolve owner display names from the profiles table in one round-trip.
  const ownerIds = Array.from(
    new Set(rawObjectives.map((o) => o.owner_id).filter((id): id is string => id != null))
  );
  const nameById = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', ownerIds);
    for (const p of (profiles ?? []) as Pick<ProfileRow, 'id' | 'full_name'>[]) {
      if (p.full_name) nameById.set(p.id, shortName(p.full_name));
    }
  }

  const objectives = rawObjectives.map((o) => {
    const state = normalizeState(o.status, o.archived_at);
    return {
      id: o.id,
      planId: o.plan_id,
      tier: deriveTier(horizonByPlan.get(o.plan_id) ?? null, o.timeline),
      title: o.objective,
      timeline: o.timeline,
      owner: o.owner_id ? (nameById.get(o.owner_id) ?? null) : null,
      priority: normalizePriority(o.priority),
      pct: statusPct(state, o.status),
      read: o.read_at != null,
      state,
      ai: o.ai_recommendation,
      // Compounding fields — defaulted to "live manual objective" when the
      // migration isn't applied, so nothing pre-existing is hidden as a draft.
      category: hasCompoundingCols ? (o.category ?? null) : null,
      source: (hasCompoundingCols ? o.source : 'manual') ?? 'manual',
      capitalWeight: hasCompoundingCols ? (o.capital_weight ?? null) : null,
      approved: hasCompoundingCols ? o.approved_at != null : true,
      parentObjectiveId: hasCompoundingCols ? (o.parent_objective_id ?? null) : null,
      lifecycleStage: hasCompoundingCols ? (o.lifecycle_stage ?? null) : null
    } satisfies StrategyObjective;
  });

  return {
    planName: plans[0]?.name ?? null,
    objectives
  };
}
