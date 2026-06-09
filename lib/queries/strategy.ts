import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';
import type { LifecycleStage } from '@/lib/lifecycle';
import {
  deriveObjectivePct,
  isPendingDraft,
  type ObjectiveSource
} from '@/lib/strategy/compounding';

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
  /** Real completion 0–100, derived from lifecycle gates / trust layers. */
  pct: number;
  read: boolean;
  state: 'open' | 'done' | 'archived';
  ai: string | null;
  /** Posture lane (Phase 2b). NULL on pre-migration / uncategorized rows. */
  category: string | null;
  /** Provenance — manual vs. an Earn/specialist draft. */
  source: ObjectiveSource;
  /**
   * True when this is a specialist/signal draft awaiting operator approval
   * ("Earn drafts, you approve"). Manual objectives are never drafts.
   */
  isDraft: boolean;
}

export interface StrategyData {
  planName: string | null;
  objectives: StrategyObjective[];
}

/**
 * Lifecycle context the page can pass so `pct` is derived from the real
 * substrate (gate progress + trust layers) without this loader re-querying what
 * `getDashboardData` already computed. All optional — when absent, `pct` falls
 * back to the legacy status mapping so the page never breaks.
 */
export interface StrategyLifecycleContext {
  gatesCleared?: Partial<Record<LifecycleStage, boolean>> | null;
  loopProgress?: number | null;
  trust?: { truth: number; concept: number; execution: number; work: number } | null;
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

/** Normalize a raw priority string to the display-cased union. */
function normalizePriority(priority: string): 'High' | 'Medium' | 'Low' {
  const p = priority.toLowerCase();
  if (p === 'high') return 'High';
  if (p === 'low') return 'Low';
  return 'Medium';
}

/** Collapse a status string + `archived_at` into the normalized objective state. */
function normalizeState(status: string, archivedAt: string | null): StrategyObjective['state'] {
  if (archivedAt) return 'archived';
  const s = status.toLowerCase();
  if (s === 'done' || s === 'complete' || s === 'completed' || s === 'closed') return 'done';
  if (s === 'archived') return 'archived';
  return 'open';
}

/** Map a raw source string to a known `ObjectiveSource`, defaulting to manual. */
function normalizeSource(source: string | null): ObjectiveSource {
  const s = (source ?? 'manual').toLowerCase();
  if (s === 'signal' || s === 'lifecycle' || s === 'cascade') return s;
  return 'manual';
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
 *
 * `lifecycle` (optional) lets the caller pass the gate/trust context so each
 * objective's `pct` is real (derived from `deriveObjectivePct`) rather than a
 * faked status mapping. Without it the loader still works and falls back.
 */
export async function getStrategyData(
  orgId: string,
  lifecycle?: StrategyLifecycleContext
): Promise<StrategyData> {
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
        'id, plan_id, objective, timeline, priority, status, read_at, archived_at, ai_recommendation, owner_id, category, source, approved_at, lifecycle_stage'
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
    | 'lifecycle_stage'
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

  const objectives = rawObjectives.map((o) => {
    const state = normalizeState(o.status, o.archived_at);
    const source = normalizeSource(o.source);
    const pct = deriveObjectivePct({
      state,
      status: o.status,
      category: o.category,
      lifecycleStage: o.lifecycle_stage,
      gatesCleared: lifecycle?.gatesCleared ?? null,
      loopProgress: lifecycle?.loopProgress ?? null,
      trust: lifecycle?.trust ?? null
    });
    return {
      id: o.id,
      planId: o.plan_id,
      tier: deriveTier(horizonByPlan.get(o.plan_id) ?? null, o.timeline),
      title: o.objective,
      timeline: o.timeline,
      owner: o.owner_id ? (nameById.get(o.owner_id) ?? null) : null,
      priority: normalizePriority(o.priority),
      pct,
      read: o.read_at != null,
      state,
      ai: o.ai_recommendation,
      category: o.category,
      source,
      isDraft: isPendingDraft({ approvedAt: o.approved_at, source })
    } satisfies StrategyObjective;
  });

  return {
    planName: plans[0]?.name ?? null,
    objectives
  };
}
