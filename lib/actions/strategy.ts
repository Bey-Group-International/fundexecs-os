'use server';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { awardTrustXp } from '@/lib/actions/xp';
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
}

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
  const { data, error } = await supabase
    .from('governance_objectives')
    .insert(insert)
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed.' };
  return { ok: true, objective: data as ObjectiveRow };
}

export interface UpdateObjectiveInput {
  objective?: string;
  timeline?: string | null;
  priority?: 'high' | 'medium' | 'low';
  aiRecommendation?: string | null;
}

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
