'use server';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { TEAM_ROSTER, proposalForTask } from '@/lib/team';
import { normalizeTaskStatus, type TaskRuntime } from '@/lib/queries/dashboard/team-tasks';
import { dispatchRunExecutor } from '@/lib/agents/executors';

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

  // Read the task (RLS-scoped to the active org) only to build the proposal
  // plan from the specialist's capability catalog. The actual write — proposal
  // row + task transition + audit append — is committed atomically inside the
  // `propose_task_run` SECURITY DEFINER function, which re-validates membership.
  const { data: task, error: readError } = await supabase
    .from('tasks')
    .select('agent_slug, title')
    .eq('id', taskId)
    .eq('org_id', org.orgId)
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };
  if (!task) return { ok: false, error: 'Task not found.' };
  if (!task.agent_slug) return { ok: false, error: 'Assign a specialist before running.' };

  const plan = proposalForTask(task.agent_slug, task.title);

  const { data: runId, error } = await supabase.rpc('propose_task_run', {
    p_task_id: taskId,
    p_action: plan.action,
    p_steps: plan.steps
  });

  if (error) return { ok: false, error: error.message };
  if (!runId) return { ok: false, error: 'Could not propose a run.' };
  return { ok: true, runId };
}

export type DecideTaskRunResult = { ok: true } | { ok: false; error: string };

/**
 * Approve or reject a proposed run. Approve clears the specialist to act and
 * moves the task to 'running'; reject sends it to 'blocked'. The decision is
 * written conditionally (only a still-`proposed` run can be decided) and both
 * outcomes are recorded to the Chain-of-Trust audit.
 *
 * On approval, the run is handed to its registered executor (if any) to produce
 * the low-stakes deliverable. Dispatch is NEVER-BLOCK: the approval has already
 * committed, so an executor error is logged inside `dispatchRunExecutor` and
 * never turns a successful decision into a failure.
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

  // The decision, task transition, and audit append all commit atomically in
  // the `decide_task_run` SECURITY DEFINER function (membership + the
  // still-`proposed` guard are enforced inside it).
  const { error } = await supabase.rpc('decide_task_run', {
    p_run_id: input.runId,
    p_decision: input.decision,
    // The function trims + nullifs an empty note, so '' is treated as "no note".
    p_note: input.note ?? ''
  });

  if (error) return { ok: false, error: error.message };

  // The decision committed. On approval, run the executor to produce the
  // deliverable — never-block, so any failure is contained and logged.
  if (input.decision === 'approved') {
    await dispatchRunExecutor(input.runId);
  }

  return { ok: true };
}
