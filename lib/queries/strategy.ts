import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

type PlanRow = Database['public']['Tables']['governance_plans']['Row'];
type ObjectiveRow = Database['public']['Tables']['governance_objectives']['Row'];

export interface StrategyObjective {
  id: string;
  planId: string;
  tier: '100' | '30' | '10';
  title: string;
  timeline: string | null;
  priority: 'High' | 'Medium' | 'Low';
  pct: number;
  read: boolean;
  state: 'open' | 'done' | 'archived';
  ai: string | null;
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

/**
 * Fetch the org's governance plans and their objectives. RLS-scoped via the
 * server client; any query error degrades to an empty result so the page
 * never throws at render time.
 */
export async function getStrategyData(orgId: string): Promise<StrategyData> {
  const supabase = await createClient();

  const [plansRes, objsRes] = await Promise.all([
    supabase
      .from('governance_plans')
      .select('id, name, horizon, status')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true }),
    supabase
      .from('governance_objectives')
      .select(
        'id, plan_id, objective, timeline, priority, status, read_at, archived_at, ai_recommendation'
      )
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
  ]);

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
  >;
  const objectives = ((objsRes.data ?? []) as ObjSel[]).map((o) => {
    const state = normalizeState(o.status, o.archived_at);
    return {
      id: o.id,
      planId: o.plan_id,
      tier: deriveTier(horizonByPlan.get(o.plan_id) ?? null, o.timeline),
      title: o.objective,
      timeline: o.timeline,
      priority: normalizePriority(o.priority),
      pct: statusPct(state, o.status),
      read: o.read_at != null,
      state,
      ai: o.ai_recommendation
    } satisfies StrategyObjective;
  });

  return {
    planName: plans[0]?.name ?? null,
    objectives
  };
}
