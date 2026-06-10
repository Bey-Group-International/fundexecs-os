import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { TEAM_ROSTER } from '@/lib/team/roster';
import { assignTask } from '@/lib/actions/tasks';
import { meterAction } from '@/lib/credits/meter';
import { emitLoopEvent } from '@/lib/loop-events.server';
import { LOOP_EVENT_TYPES } from '@/lib/loop-events';
import {
  canAdvance,
  levelToMinXp,
  WORKFLOW_MIN_LEVEL,
  WORKFLOW_STEP_STATUSES,
  type WorkflowRecord,
  type WorkflowStepRecord,
  type WorkflowStepSpec,
  type WorkflowStepStatus
} from './types';

/* ============================================================================
 * lib/workflows/engine.ts — server-side Earn workflow engine.
 *
 * Three public surfaces:
 *   startWorkflow        — XP-gated; creates the envelope + steps.
 *   advanceWorkflowStep  — validates the pure state machine, meters the step,
 *                          optionally assigns a task, emits workflowAdvanced.
 *   getWorkflow          — org-scoped read of workflow + steps.
 *
 * RLS: reads go through the user-scoped client (org membership enforced by RLS
 * on earn_workflows/earn_workflow_steps). Step metering goes through the admin
 * client via meterAction — the same pattern as diligence_run.
 * Fail policy for metering: infra failures fail-open; genuine insufficient
 * balance fails-closed (the caller surfaces a 402).
 * ============================================================================ */

const VALID_SLUGS = new Set(TEAM_ROSTER.map((m) => m.slug));

/* --------------------------------------------------------------------------
 * Shared row → domain mapper
 * ------------------------------------------------------------------------ */

function mapStepRow(row: {
  id: string;
  workflow_id: string;
  ordinal: number;
  title: string;
  specialist_slug: string | null;
  status: string;
  result: unknown;
  created_at: string;
  updated_at: string;
}): WorkflowStepRecord {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    ordinal: row.ordinal,
    title: row.title,
    specialistSlug: row.specialist_slug,
    // Coerce the DB string to our union; fall back to 'pending' on unknown values.
    status: (WORKFLOW_STEP_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as WorkflowStepStatus)
      : 'pending',
    result: (row.result as import('@/lib/supabase/database.types').Json | null) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/* --------------------------------------------------------------------------
 * startWorkflow — XP-gated workflow creation.
 * ------------------------------------------------------------------------ */

export interface StartWorkflowInput {
  /** The org the workflow runs under (must match the caller's active org). */
  orgId: string;
  /** The authenticated user starting the workflow. */
  userId: string;
  /** Short machine kind, e.g. 'lp_outreach' | 'deal_diligence'. */
  kind: string;
  /** Ordered step specs — at least one required. */
  steps: WorkflowStepSpec[];
}

export type StartWorkflowResult =
  | { ok: true; workflowId: string }
  | { ok: false; reason: 'locked'; requiredLevel: number; currentLevel: number }
  | { ok: false; reason: 'invalid_input'; message: string }
  | { ok: false; reason: 'db_error'; message: string };

/**
 * XP gate: read the caller's accumulated XP from `profiles.xp` server-side
 * and derive the level; reject if below WORKFLOW_MIN_LEVEL.
 */
async function readUserLevel(userId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('xp').eq('id', userId).maybeSingle();
  const xp = data?.xp ?? 0;
  // Mirror xpToLevel from lib/queries/identity.ts: floor(sqrt(xp/100)) + 1.
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
}

export async function startWorkflow(input: StartWorkflowInput): Promise<StartWorkflowResult> {
  const { orgId, userId, kind, steps } = input;

  // — Input validation -------------------------------------------------------
  if (!kind?.trim()) {
    return { ok: false, reason: 'invalid_input', message: 'kind is required.' };
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, reason: 'invalid_input', message: 'At least one step is required.' };
  }
  for (const [i, step] of steps.entries()) {
    if (!step.title?.trim()) {
      return {
        ok: false,
        reason: 'invalid_input',
        message: `Step ${i + 1} is missing a title.`
      };
    }
    if (!VALID_SLUGS.has(step.specialistSlug)) {
      return {
        ok: false,
        reason: 'invalid_input',
        message: `Step ${i + 1} references an unknown specialist slug "${step.specialistSlug}".`
      };
    }
  }

  // — XP gate ----------------------------------------------------------------
  const currentLevel = await readUserLevel(userId);
  if (currentLevel < WORKFLOW_MIN_LEVEL) {
    return {
      ok: false,
      reason: 'locked',
      requiredLevel: WORKFLOW_MIN_LEVEL,
      currentLevel
    };
  }

  // — Persist (user-scoped client — RLS enforces org membership) -------------
  const supabase = await createClient();

  const { data: workflow, error: wfError } = await supabase
    .from('earn_workflows')
    .insert({
      org_id: orgId,
      created_by: userId,
      kind: kind.trim(),
      status: 'pending',
      current_step: 0
    })
    .select('id')
    .single();

  if (wfError || !workflow) {
    return {
      ok: false,
      reason: 'db_error',
      message: wfError?.message ?? 'Could not create workflow.'
    };
  }

  const stepRows = steps.map((s, i) => ({
    workflow_id: workflow.id,
    ordinal: i,
    title: s.title.trim(),
    specialist_slug: s.specialistSlug,
    status: 'pending' as const
  }));

  const { error: stepsError } = await supabase.from('earn_workflow_steps').insert(stepRows);

  if (stepsError) {
    // Best-effort clean up the orphaned workflow header.
    await supabase.from('earn_workflows').delete().eq('id', workflow.id);
    return { ok: false, reason: 'db_error', message: stepsError.message };
  }

  return { ok: true, workflowId: workflow.id };
}

/* --------------------------------------------------------------------------
 * advanceWorkflowStep — transition a step, meter, optionally assign a task.
 * ------------------------------------------------------------------------ */

export interface AdvanceWorkflowStepInput {
  orgId: string;
  userId: string;
  workflowId: string;
  stepId: string;
  toStatus: WorkflowStepStatus;
}

export type AdvanceWorkflowStepResult =
  | { ok: true }
  | { ok: false; reason: 'not_found'; message: string }
  | { ok: false; reason: 'invalid_transition'; from: WorkflowStepStatus; to: WorkflowStepStatus }
  | { ok: false; reason: 'insufficient_credits'; balance: number }
  | { ok: false; reason: 'db_error'; message: string };

export async function advanceWorkflowStep(
  input: AdvanceWorkflowStepInput
): Promise<AdvanceWorkflowStepResult> {
  const { orgId, workflowId, stepId, toStatus, userId } = input;

  if (!(WORKFLOW_STEP_STATUSES as readonly string[]).includes(toStatus)) {
    return {
      ok: false,
      reason: 'invalid_transition',
      from: 'pending', // unknown current; guard before any read
      to: toStatus
    };
  }

  // Read the current step — RLS scopes to org members.
  const supabase = await createClient();
  const { data: step, error: readError } = await supabase
    .from('earn_workflow_steps')
    .select('id, status, specialist_slug, title, workflow_id')
    .eq('id', stepId)
    .eq('workflow_id', workflowId)
    .maybeSingle();

  if (readError) {
    return { ok: false, reason: 'db_error', message: readError.message };
  }
  if (!step) {
    return { ok: false, reason: 'not_found', message: 'Step not found.' };
  }

  const from = (WORKFLOW_STEP_STATUSES as readonly string[]).includes(step.status)
    ? (step.status as WorkflowStepStatus)
    : 'pending';

  // No-op when already there.
  if (from === toStatus) return { ok: true };

  // Pure state-machine guard.
  if (!canAdvance(from, toStatus)) {
    return { ok: false, reason: 'invalid_transition', from, to: toStatus };
  }

  // — Per-step credit metering when moving INTO execution -------------------
  // Meter when the step becomes active (doing real work) or when it moves
  // to awaiting_approval (specialist finished a unit of execution).
  const shouldMeter = toStatus === 'active' || toStatus === 'awaiting_approval';
  if (shouldMeter) {
    const meter = await meterAction(orgId, 'workflow_step', stepId);
    if (!meter.ok && meter.reason === 'insufficient') {
      return { ok: false, reason: 'insufficient_credits', balance: meter.balance };
    }
    // Any other meter failure (infra) falls through — fail-open.
  }

  // — Conditional update on exact current status (optimistic concurrency) ---
  const { data: updated, error: updateError } = await supabase
    .from('earn_workflow_steps')
    .update({ status: toStatus })
    .eq('id', stepId)
    .eq('workflow_id', workflowId)
    .eq('status', step.status) // Reject if another writer raced us.
    .select('id');

  if (updateError) {
    return { ok: false, reason: 'db_error', message: updateError.message };
  }
  if (!updated || updated.length === 0) {
    return {
      ok: false,
      reason: 'db_error',
      message: 'Step changed concurrently — refresh and retry.'
    };
  }

  // — Update workflow header current_step + status (best-effort) ------------
  // Mirror the highest ordinal that is now active/done.
  void updateWorkflowStatus(supabase, workflowId, orgId);

  // — Optionally assign the step to the specialist as a task ----------------
  // Only when stepping INTO active so the task represents real in-flight work.
  if (toStatus === 'active' && step.specialist_slug && VALID_SLUGS.has(step.specialist_slug)) {
    await assignTask({
      agentSlug: step.specialist_slug,
      title: step.title,
      description: `Workflow step (${workflowId})`,
      priority: 1
    });
    // assignTask failures are non-fatal — the workflow step advanced regardless.
  }

  // — Emit loop event (best-effort — never throws) --------------------------
  void emitLoopEvent({
    orgId,
    verb: 'run',
    eventType: LOOP_EVENT_TYPES.workflowAdvanced,
    entityType: 'earn_workflow_step',
    entityId: stepId,
    metadata: {
      workflowId,
      fromStatus: from,
      toStatus,
      specialistSlug: step.specialist_slug ?? null,
      userId
    }
  });

  return { ok: true };
}

/**
 * Recompute and write the workflow envelope's `status` + `current_step` from
 * its steps. Called best-effort after each step advance; never throws.
 */
async function updateWorkflowStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workflowId: string,
  orgId: string
): Promise<void> {
  try {
    const { data: allSteps } = await supabase
      .from('earn_workflow_steps')
      .select('ordinal, status')
      .eq('workflow_id', workflowId)
      .order('ordinal', { ascending: true });

    if (!allSteps || allSteps.length === 0) return;

    const terminal = new Set(['done', 'skipped', 'failed']);
    const hasFailed = allSteps.some((s) => s.status === 'failed');
    const allTerminal = allSteps.every((s) => terminal.has(s.status));
    const allDoneOrSkipped = allSteps.every((s) => s.status === 'done' || s.status === 'skipped');

    let wfStatus: string;
    if (hasFailed && !allDoneOrSkipped) {
      wfStatus = 'failed';
    } else if (allTerminal) {
      wfStatus = 'done';
    } else {
      wfStatus = 'running';
    }

    // current_step = ordinal of the first non-terminal step, or last ordinal.
    const firstActive = allSteps.find((s) => !terminal.has(s.status));
    const currentStep = firstActive?.ordinal ?? allSteps[allSteps.length - 1]!.ordinal;

    await supabase
      .from('earn_workflows')
      .update({ status: wfStatus, current_step: currentStep })
      .eq('id', workflowId)
      .eq('org_id', orgId);
  } catch {
    // Best-effort — never surface.
  }
}

/* --------------------------------------------------------------------------
 * getWorkflow — org-scoped read.
 * ------------------------------------------------------------------------ */

export type GetWorkflowResult =
  | { ok: true; workflow: WorkflowRecord }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'db_error'; message: string };

export async function getWorkflow(orgId: string, workflowId: string): Promise<GetWorkflowResult> {
  const supabase = await createClient();

  const { data: wf, error: wfError } = await supabase
    .from('earn_workflows')
    .select('id, org_id, created_by, kind, status, current_step, created_at, updated_at')
    .eq('id', workflowId)
    .eq('org_id', orgId)
    .maybeSingle();

  if (wfError) {
    return { ok: false, reason: 'db_error', message: wfError.message };
  }
  if (!wf) {
    return { ok: false, reason: 'not_found' };
  }

  const { data: steps, error: stepsError } = await supabase
    .from('earn_workflow_steps')
    .select(
      'id, workflow_id, ordinal, title, specialist_slug, status, result, created_at, updated_at'
    )
    .eq('workflow_id', workflowId)
    .order('ordinal', { ascending: true });

  if (stepsError) {
    return { ok: false, reason: 'db_error', message: stepsError.message };
  }

  return {
    ok: true,
    workflow: {
      id: wf.id,
      orgId: wf.org_id,
      createdBy: wf.created_by,
      kind: wf.kind,
      status: wf.status as WorkflowRecord['status'],
      currentStep: wf.current_step,
      createdAt: wf.created_at,
      updatedAt: wf.updated_at,
      steps: (steps ?? []).map(mapStepRow)
    }
  };
}
