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
  /** Posture lane: 'capital' | 'governance' | 'compliance' | 'execution' | null. */
  category: string | null;
  /** Provenance: 'manual' | 'signal' | 'lifecycle' | 'cascade'. */
  source: string;
  /**
   * True when this is an unapproved specialist/signal draft (source ≠ manual
   * AND not yet approved). Drafts are proposed to the operator, not yet in the
   * live plan.
   */
  isDraft: boolean;
}

export interface StrategyData {
  planName: string | null;
  /** Live plan — manual or approved objectives only. */
  objectives: StrategyObjective[];
  /** Pending drafts proposed by the executive team / signals, awaiting approval. */
  drafts: StrategyObjective[];
}

const EMPTY: StrategyData = { planName: null, objectives: [], drafts: [] };

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

  const [plansRes, objsRes] = await Promise.all([
    supabase
      .from('governance_plans')
      .select('id, name, horizon, status')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true }),
    supabase
      .from('governance_objectives')
      .select(
        'id, plan_id, objective, timeline, priority, status, read_at, archived_at, ai_recommendation, owner_id, category, source, approved_at'
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
    | 'owner_id'
    | 'category'
    | 'source'
    | 'approved_at'
  >;
  const rawObjectives = (objsRes.data ?? []) as ObjSel[];

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

  const mapped = rawObjectives.map((o) => {
    const state = normalizeState(o.status, o.archived_at);
    const source = o.source ?? 'manual';
    // A draft is a specialist/signal proposal that hasn't been approved into
    // the live plan. Manual objectives are always live regardless of approval.
    const isDraft = source !== 'manual' && o.approved_at == null;
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
      category: o.category ?? null,
      source,
      isDraft
    } satisfies StrategyObjective;
  });

  return {
    planName: plans[0]?.name ?? null,
    objectives: mapped.filter((o) => !o.isDraft),
    drafts: mapped.filter((o) => o.isDraft)
  };
}
