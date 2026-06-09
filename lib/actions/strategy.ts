'use server';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { awardTrustXp } from '@/lib/actions/xp';
import { loadLifecycleContext } from '@/lib/queries/dashboard/lifecycle';
import { computeLifecycleStageResult } from '@/lib/lifecycle';
import {
  computeCascadeChildren,
  detectGateUnlock,
  type GateUnlock,
  type ObjectiveTier,
  type CascadeChildSpec
} from '@/lib/strategy/compounding';
import type { Database } from '@/lib/supabase/database.types';

type ObjectiveRow = Database['public']['Tables']['governance_objectives']['Row'];
type ObjectiveInsert = Database['public']['Tables']['governance_objectives']['Insert'];
type ObjectiveUpdate = Database['public']['Tables']['governance_objectives']['Update'];
type PlanRow = Database['public']['Tables']['governance_plans']['Row'];

export type ObjectiveResult = { ok: true; objective: ObjectiveRow } | { ok: false; error: string };

export interface CreateObjectiveInput {
  /** Plan id is optional — if omitted we attach to the org's first plan. */
  planId?: string | null;
  objective: string;
  timeline?: string | null;
  priority?: 'high' | 'medium' | 'low';
  aiRecommendation?: string | null;
  // Phase 2b (requires the strategy_objective_compounding migration). All
  // optional and only written to the insert when explicitly provided, so the
  // existing manual-create path (ObjectiveDrawer) is unchanged and safe to run
  // before the migration is applied.
  /** Posture lane this objective belongs to. */
  category?: 'capital' | 'governance' | 'compliance' | 'execution';
  /** Value-at-stake multiplier for capital-weighted scoring. */
  capitalWeight?: number;
  /** Where the objective came from. Defaults to 'manual' at the DB level. */
  source?: 'manual' | 'signal' | 'lifecycle' | 'cascade';
  /** The market signal this was drafted from, when source='signal'. */
  sourceSignalId?: string | null;
  /** Cascade parent — set when this is a child spawned from a completed bet. */
  parentObjectiveId?: string | null;
  /** Lifecycle loop stage this objective advances. */
  lifecycleStage?: string | null;
  /**
   * When true, stamp `approved_at` now (the objective enters the live plan
   * immediately). Specialist drafts omit this and stay pending until approved.
   * Omitted entirely → `approved_at` is left untouched, preserving the legacy
   * insert shape.
   */
  approved?: boolean;
}

/**
 * Resolve the plan id to attach an objective to: the explicitly requested id when
 * given, otherwise the org's earliest governance plan. Returns null when neither
 * resolves so the caller can surface a clear error.
 */
async function resolvePlanId(orgId: string, requested: string | null): Promise<string | null> {
  if (requested) return requested;
  const supabase = await createClient();
  const { data } = await supabase
    .from('governance_plans')
    .select('id')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as Pick<PlanRow, 'id'> | null)?.id ?? null;
}

/**
 * Create a governance objective for the active org. The legacy manual path only
 * needs `objective` (+ optional plan/timeline/priority); Phase 2b fields are
 * written only when explicitly provided so existing callers are unaffected.
 * RLS-scoped; returns a typed error result rather than throwing.
 */
export async function createObjective(input: CreateObjectiveInput): Promise<ObjectiveResult> {
  const title = input.objective?.trim();
  if (!title) return { ok: false, error: 'Objective text is required.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const planId = await resolvePlanId(org.orgId, input.planId ?? null);
  if (!planId) return { ok: false, error: 'No governance plan to attach this objective to.' };

  const supabase = await createClient();
  const insert: ObjectiveInsert = {
    org_id: org.orgId,
    plan_id: planId,
    objective: title,
    timeline: input.timeline ?? null,
    priority: input.priority ?? 'medium',
    status: 'open',
    ai_recommendation: input.aiRecommendation ?? null,
    owner_id: org.userId
  };
  // Phase 2b fields — only added when provided so the legacy insert is untouched.
  if (input.category !== undefined) insert.category = input.category;
  if (input.capitalWeight !== undefined) insert.capital_weight = input.capitalWeight;
  if (input.source !== undefined) insert.source = input.source;
  if (input.sourceSignalId !== undefined) insert.source_signal_id = input.sourceSignalId;
  if (input.parentObjectiveId !== undefined) insert.parent_objective_id = input.parentObjectiveId;
  if (input.lifecycleStage !== undefined) insert.lifecycle_stage = input.lifecycleStage;
  if (input.approved === true) insert.approved_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('governance_objectives')
    .insert(insert)
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed.' };
  return { ok: true, objective: data as ObjectiveRow };
}

/**
 * Approve a pending specialist/signal draft into the live plan by stamping
 * `approved_at`. Phase 2b — requires the strategy_objective_compounding
 * migration; not yet wired to the UI.
 */
export async function approveDraftObjective(id: string): Promise<ObjectiveResult> {
  if (!id) return { ok: false, error: 'Missing objective id.' };

  const supabase = await createClient();
  const update: ObjectiveUpdate = { approved_at: new Date().toISOString(), status: 'open' };
  const { data, error } = await supabase
    .from('governance_objectives')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Approve failed.' };
  return { ok: true, objective: data as ObjectiveRow };
}

export interface UpdateObjectiveInput {
  objective?: string;
  timeline?: string | null;
  priority?: 'high' | 'medium' | 'low';
  aiRecommendation?: string | null;
}

/**
 * Patch an objective's editable fields (title/timeline/priority/recommendation).
 * Only provided keys are written; an empty patch or blank title is rejected with
 * a typed error. RLS-scoped; never throws.
 */
export async function updateObjective(
  id: string,
  patch: UpdateObjectiveInput
): Promise<ObjectiveResult> {
  if (!id) return { ok: false, error: 'Missing objective id.' };

  const update: ObjectiveUpdate = {};
  if (patch.objective !== undefined) {
    const t = patch.objective.trim();
    if (!t) return { ok: false, error: 'Objective text cannot be empty.' };
    update.objective = t;
  }
  if (patch.timeline !== undefined) update.timeline = patch.timeline;
  if (patch.priority !== undefined) update.priority = patch.priority;
  if (patch.aiRecommendation !== undefined) update.ai_recommendation = patch.aiRecommendation;
  if (Object.keys(update).length === 0) return { ok: false, error: 'Nothing to update.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('governance_objectives')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Update failed.' };
  return { ok: true, objective: data as ObjectiveRow };
}

export type ObjectiveStatus = 'open' | 'completed' | 'archived';

/**
 * Status transitions for an objective. `completed` fires execution-layer
 * XP and stamps `closed_at`. `archived` sets `archived_at` (soft delete).
 * `open` clears both timestamps and reopens the objective.
 */
export async function setObjectiveStatus(
  id: string,
  status: ObjectiveStatus
): Promise<ObjectiveResult> {
  if (!id) return { ok: false, error: 'Missing objective id.' };

  const now = new Date().toISOString();
  const update: ObjectiveUpdate = { status };
  if (status === 'completed') {
    update.closed_at = now;
    update.archived_at = null;
  } else if (status === 'archived') {
    update.archived_at = now;
  } else {
    update.closed_at = null;
    update.archived_at = null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('governance_objectives')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Status update failed.' };

  if (status === 'completed') {
    try {
      await awardTrustXp({ layer: 'execution', entityType: 'objective', entityId: id });
    } catch {
      // best-effort
    }
  }
  return { ok: true, objective: data as ObjectiveRow };
}

/* ---------------------------------------------------------------------------
 * Compounding: cascade on completion + gate-unlock writeback (Phase 2b).
 * ------------------------------------------------------------------------- */

/** Derive the 100/30/10 tier from an objective's plan horizon + timeline. */
function deriveTier(horizon: string | null, timeline: string | null): ObjectiveTier {
  const hay = `${horizon ?? ''} ${timeline ?? ''}`.toLowerCase();
  if (hay.includes('100')) return '100';
  if (hay.includes('30')) return '30';
  if (hay.includes('10')) return '10';
  return '100';
}

/**
 * Spawn the next-tier child drafts for a completed objective. Closing a 100-day
 * bet proposes its 30-day milestone; a 30 proposes a 10-day move; a 10 is a leaf
 * (no children). Children are inserted as `source='cascade'` drafts (unapproved)
 * so the operator still confirms them — "Earn drafts, you approve". Best-effort:
 * any failure leaves the parent completion intact. Exported so it can be invoked
 * directly (e.g. from a batch flow) as well as from the completion path.
 */
export async function cascadeObjective(id: string): Promise<{ spawned: number }> {
  try {
    const org = await getActiveOrg();
    if (!org) return { spawned: 0 };

    const supabase = await createClient();
    const { data: parent } = await supabase
      .from('governance_objectives')
      .select('id, org_id, plan_id, objective, timeline, category, lifecycle_stage')
      .eq('id', id)
      .maybeSingle();
    if (!parent) return { spawned: 0 };

    const { data: plan } = await supabase
      .from('governance_plans')
      .select('horizon')
      .eq('id', parent.plan_id)
      .maybeSingle();

    const tier = deriveTier(
      (plan as { horizon: string | null } | null)?.horizon ?? null,
      parent.timeline
    );
    const children: CascadeChildSpec[] = computeCascadeChildren({
      tier,
      title: parent.objective,
      category: parent.category,
      lifecycleStage: parent.lifecycle_stage
    });
    if (children.length === 0) return { spawned: 0 };

    // Idempotency guard — if this parent already has cascade children, don't
    // spawn a second set (re-completing / double-invocation is a no-op).
    const { count: existingChildren } = await supabase
      .from('governance_objectives')
      .select('id', { count: 'exact', head: true })
      .eq('parent_objective_id', parent.id)
      .eq('source', 'cascade')
      .is('deleted_at', null);
    if ((existingChildren ?? 0) > 0) return { spawned: 0 };

    const rows: ObjectiveInsert[] = children.map((c) => ({
      org_id: parent.org_id,
      plan_id: parent.plan_id,
      objective: c.objective,
      timeline: c.timeline,
      priority: 'medium',
      status: 'open',
      owner_id: org.userId,
      source: 'cascade',
      parent_objective_id: parent.id,
      category: c.category,
      lifecycle_stage: c.lifecycleStage
      // approved_at intentionally left null → enters as a pending draft.
    }));

    const { data, error } = await supabase.from('governance_objectives').insert(rows).select('id');
    if (error) return { spawned: 0 };
    return { spawned: (data ?? []).length };
  } catch {
    return { spawned: 0 };
  }
}

export interface CompleteObjectiveResult {
  ok: boolean;
  error?: string;
  objective?: ObjectiveRow;
  /** Cascade children spawned as drafts (count). */
  cascadeSpawned: number;
  /** The stage a newly-cleared gate unlocked, when completion flipped one. */
  gateUnlock: GateUnlock | null;
}

/**
 * Complete an objective with the full compounding payload: marks it done (reusing
 * `setObjectiveStatus`), spawns the next-tier cascade drafts, and re-runs the
 * lifecycle engine to detect whether the completion flipped a gate cleared — if
 * so it surfaces the unlocked stage. Each compounding step is best-effort and
 * never undoes the completion. RLS-scoped via the underlying actions.
 */
export async function completeObjective(id: string): Promise<CompleteObjectiveResult> {
  if (!id)
    return { ok: false, error: 'Missing objective id.', cascadeSpawned: 0, gateUnlock: null };

  const org = await getActiveOrg();

  // Snapshot the lifecycle gates BEFORE the write so we can diff for an unlock.
  let beforeGates: ReturnType<typeof computeLifecycleStageResult>['gatesCleared'] | null = null;
  if (org) {
    try {
      const { inputs } = await loadLifecycleContext(org.orgId);
      beforeGates = computeLifecycleStageResult(inputs).gatesCleared;
    } catch {
      beforeGates = null;
    }
  }

  const result = await setObjectiveStatus(id, 'completed');
  if (!result.ok) return { ok: false, error: result.error, cascadeSpawned: 0, gateUnlock: null };

  // Cascade — spawn the next-tier draft(s).
  const { spawned } = await cascadeObjective(id);

  // Gate-unlock — re-run the engine and diff the gate state.
  let gateUnlock: GateUnlock | null = null;
  if (org && beforeGates) {
    try {
      const { inputs } = await loadLifecycleContext(org.orgId);
      const afterGates = computeLifecycleStageResult(inputs).gatesCleared;
      gateUnlock = detectGateUnlock(beforeGates, afterGates);
    } catch {
      gateUnlock = null;
    }
  }

  return { ok: true, objective: result.objective, cascadeSpawned: spawned, gateUnlock };
}

/**
 * Soft-delete via `deleted_at`. Reserve hard delete for explicit owner
 * cleanup flows.
 */
export async function deleteObjective(id: string): Promise<ObjectiveResult> {
  if (!id) return { ok: false, error: 'Missing objective id.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('governance_objectives')
    .update({ deleted_at: new Date().toISOString(), status: 'archived' })
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Delete failed.' };
  return { ok: true, objective: data as ObjectiveRow };
}

/**
 * Stamp `read_at` the first time an objective is opened (no-op if already read).
 * RLS-scoped; returns ok with a minimal stub when there was nothing to update.
 */
export async function markObjectiveRead(id: string): Promise<ObjectiveResult> {
  if (!id) return { ok: false, error: 'Missing objective id.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('governance_objectives')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null)
    .select('*')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: true, objective: { id } as ObjectiveRow };
  return { ok: true, objective: data as ObjectiveRow };
}
