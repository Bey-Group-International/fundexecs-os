'use server';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { TEAM_ROSTER } from '@/lib/team';
import type { TaskRuntime } from '@/lib/queries/dashboard/team-tasks';

/* ============================================================================
 * lib/actions/tasks.ts — write paths for the Team-tasks board (Phase 1).
 *
 * assignTask        — create a task owned by an AI specialist (status 'queued').
 * updateTaskStatus  — move a task through its lifecycle (RLS-scoped).
 * Both are RLS-scoped via the request-scoped client (org members read/write
 * their org's tasks). Execution of the work is a later phase.
 * ========================================================================= */

const VALID_SLUGS = new Set(TEAM_ROSTER.map((m) => m.slug));

const RUNTIME_STATUSES: readonly TaskRuntime[] = [
  'queued',
  'running',
  'awaiting',
  'blocked',
  'done',
  'failed'
];

export type TaskActionResult = { ok: true; id: string } | { ok: false; error: string };

export interface AssignTaskInput {
  agentSlug: string;
  title: string;
  description?: string;
  dueAt?: string | null;
  priority?: number;
}

export async function assignTask(input: AssignTaskInput): Promise<TaskActionResult> {
  const title = input.title?.trim();
  if (!title) return { ok: false, error: 'A task title is required.' };
  if (!VALID_SLUGS.has(input.agentSlug)) {
    return { ok: false, error: 'Unknown specialist.' };
  }

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      org_id: org.orgId,
      agent_slug: input.agentSlug,
      title,
      description: input.description?.trim() || null,
      due_at: input.dueAt ?? null,
      priority: Number.isFinite(input.priority) ? Number(input.priority) : 0,
      status: 'queued',
      source: 'desk'
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'Could not assign the task.' };
  return { ok: true, id: data.id };
}

export type UpdateTaskStatusResult = { ok: true } | { ok: false; error: string };

export async function updateTaskStatus(input: {
  id: string;
  status: TaskRuntime;
}): Promise<UpdateTaskStatusResult> {
  if (!input.id) return { ok: false, error: 'Missing task.' };
  if (!RUNTIME_STATUSES.includes(input.status)) {
    return { ok: false, error: 'Invalid status.' };
  }

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('tasks')
    .update({ status: input.status })
    .eq('id', input.id)
    .eq('org_id', org.orgId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
