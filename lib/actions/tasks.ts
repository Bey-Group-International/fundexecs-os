'use server';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { TEAM_ROSTER, proposalForTask } from '@/lib/team';
import { normalizeTaskStatus, type TaskRuntime } from '@/lib/queries/dashboard/team-tasks';

/* ============================================================================
 * lib/actions/tasks.ts — write paths for the Team-tasks board.
 *
 * assignTask        — create a task owned by an AI specialist (status 'queued').
 * updateTaskStatus  — move a task through its lifecycle (RLS-scoped).
 * runTask           — propose a gated run: build a plan from the specialist's
 *                     capability catalog, park the task at 'awaiting', and log
 *                     the proposal to the Chain-of-Trust audit.
 * decideTaskRun     — operator approves (→ running) or rejects (→ blocked) a
 *                     proposed run; both decisions are audited.
 * All are RLS-scoped via the request-scoped client (org members read/write
 * their org's tasks + runs). No external side effects execute in this phase —
 * a run is an authorization record, not a live action.
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

/** Legal lifecycle moves (normalized status → allowed targets). */
const ALLOWED_TRANSITIONS: Record<TaskRuntime, readonly TaskRuntime[]> = {
  queued: ['running', 'blocked', 'failed'],
  blocked: ['running', 'queued', 'failed'],
  awaiting: ['running', 'failed'],
  running: ['done', 'awaiting', 'blocked', 'failed'],
  failed: ['queued', 'running'],
  done: []
};

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

  // Read the current row first so we can validate the transition and make the
  // write conditional (optimistic concurrency).
  const { data: existing, error: readError } = await supabase
    .from('tasks')
    .select('status')
    .eq('id', input.id)
    .eq('org_id', org.orgId)
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };
  if (!existing) return { ok: false, error: 'Task not found.' };

  const from = normalizeTaskStatus(existing.status);
  if (from === input.status) return { ok: true }; // already there — no-op
  if (!ALLOWED_TRANSITIONS[from].includes(input.status)) {
    return { ok: false, error: `Can't move a ${from} task to ${input.status}.` };
  }

  // Conditional update on the exact current status; verify a row actually moved.
  const { data: updated, error } = await supabase
    .from('tasks')
    .update({ status: input.status })
    .eq('id', input.id)
    .eq('org_id', org.orgId)
    .eq('status', existing.status)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!updated || updated.length === 0) {
    return { ok: false, error: 'The task changed — refresh and try again.' };
  }
  return { ok: true };
}

/* ---- Gated execution scaffold (Phase 2) --------------------------------- */

export type RunTaskResult = { ok: true; runId: string } | { ok: false; error: string };

/**
 * Propose a run for a queued/blocked task. Builds a deterministic plan from the
 * specialist's capability catalog, records it as a `proposed` task_run, parks
 * the task at 'awaiting' (needs your approval), and writes an audit row. A
 * partial unique index keeps this idempotent — a second call returns the open
 * proposal instead of duplicating it. Nothing executes; this only authorizes.
 */
export async function runTask(taskId: string): Promise<RunTaskResult> {
  if (!taskId) return { ok: false, error: 'Missing task.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();

  const { data: task, error: readError } = await supabase
    .from('tasks')
    .select('id, agent_slug, title, status')
    .eq('id', taskId)
    .eq('org_id', org.orgId)
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };
  if (!task) return { ok: false, error: 'Task not found.' };
  if (!task.agent_slug) return { ok: false, error: 'Assign a specialist before running.' };

  const state = normalizeTaskStatus(task.status);
  if (state === 'awaiting') {
    // Already proposed — return the open run so the card is idempotent.
    const { data: open } = await supabase
      .from('task_runs')
      .select('id')
      .eq('task_id', task.id)
      .eq('status', 'proposed')
      .maybeSingle();
    if (open) return { ok: true, runId: open.id };
  } else if (state !== 'queued' && state !== 'blocked') {
    return { ok: false, error: `A ${state} task can't be proposed for a run.` };
  }

  const plan = proposalForTask(task.agent_slug, task.title);

  const { data: run, error: insertError } = await supabase
    .from('task_runs')
    .insert({
      org_id: org.orgId,
      task_id: task.id,
      agent_slug: task.agent_slug,
      action: plan.action,
      steps: plan.steps,
      status: 'proposed',
      proposed_by: org.userId
    })
    .select('id')
    .single();

  if (insertError || !run) {
    // Unique-index race: another request just opened a proposal. Return it.
    const { data: open } = await supabase
      .from('task_runs')
      .select('id')
      .eq('task_id', task.id)
      .eq('status', 'proposed')
      .maybeSingle();
    if (open) return { ok: true, runId: open.id };
    return { ok: false, error: insertError?.message ?? 'Could not propose a run.' };
  }

  // Park the task at 'awaiting' from its current status (optimistic).
  await supabase
    .from('tasks')
    .update({ status: 'awaiting' })
    .eq('id', task.id)
    .eq('org_id', org.orgId)
    .eq('status', task.status);

  await supabase.from('trust_events').insert({
    org_id: org.orgId,
    actor_id: org.userId,
    entity_type: 'task_run',
    entity_id: run.id,
    action: 'task_run_proposed',
    metadata: { task_id: task.id, agent_slug: task.agent_slug, run_action: plan.action }
  });

  return { ok: true, runId: run.id };
}

export type DecideTaskRunResult = { ok: true } | { ok: false; error: string };

/**
 * Approve or reject a proposed run. Approve clears the specialist to act and
 * moves the task to 'running'; reject sends it to 'blocked'. The decision is
 * written conditionally (only a still-`proposed` run can be decided) and both
 * outcomes are recorded to the Chain-of-Trust audit.
 */
export async function decideTaskRun(input: {
  runId: string;
  decision: 'approved' | 'rejected';
  note?: string;
}): Promise<DecideTaskRunResult> {
  if (!input.runId) return { ok: false, error: 'Missing run.' };
  if (input.decision !== 'approved' && input.decision !== 'rejected') {
    return { ok: false, error: 'Invalid decision.' };
  }

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();

  const { data: run, error: readError } = await supabase
    .from('task_runs')
    .select('id, task_id, status')
    .eq('id', input.runId)
    .eq('org_id', org.orgId)
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };
  if (!run) return { ok: false, error: 'Run not found.' };
  if (run.status !== 'proposed') return { ok: false, error: 'This run was already decided.' };

  const { data: decided, error: decideError } = await supabase
    .from('task_runs')
    .update({
      status: input.decision,
      decided_by: org.userId,
      decided_at: new Date().toISOString(),
      decision_note: input.note?.trim() || null
    })
    .eq('id', run.id)
    .eq('org_id', org.orgId)
    .eq('status', 'proposed')
    .select('id');

  if (decideError) return { ok: false, error: decideError.message };
  if (!decided || decided.length === 0) {
    return { ok: false, error: 'The run changed — refresh and try again.' };
  }

  // Move the task: approve → running (cleared to act), reject → blocked. Only
  // act on a still-awaiting task so a concurrent change isn't clobbered.
  const nextStatus = input.decision === 'approved' ? 'running' : 'blocked';
  await supabase
    .from('tasks')
    .update({ status: nextStatus })
    .eq('id', run.task_id)
    .eq('org_id', org.orgId)
    .eq('status', 'awaiting');

  await supabase.from('trust_events').insert({
    org_id: org.orgId,
    actor_id: org.userId,
    entity_type: 'task_run',
    entity_id: run.id,
    action: input.decision === 'approved' ? 'task_run_approved' : 'task_run_rejected',
    metadata: { task_id: run.task_id, note: input.note?.trim() || null }
  });

  return { ok: true };
}
