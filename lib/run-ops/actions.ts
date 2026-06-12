'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import {
  COMPLIANCE_BASELINE,
  IR_BASELINE,
  WORKFLOW_BASELINE,
  isComplianceResolvable,
  isTaskStatus,
  nextTaskStatus,
  type TaskStatus
} from './vocabulary';

/**
 * lib/run-ops/actions.ts — mutations for the Run interiors.
 *
 * Baselines seed once (idempotent: a non-empty surface refuses to re-seed);
 * advancement moves exactly one status step, enforced server-side.
 * Member-scoped through RLS (write policies added by 20260611260000).
 */

export type RunOpsActionResult = { ok: true; created?: number } | { ok: false; error: string };

/** Seed Sterling's launch plan — workflows + their tasks. Once. */
export async function seedWorkflows(): Promise<RunOpsActionResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const { count } = await supabase
    .from('workflows')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', org.orgId);
  if ((count ?? 0) > 0) return { ok: false, error: 'Workflows are already set up.' };

  let created = 0;
  for (const wf of WORKFLOW_BASELINE) {
    const { data: row, error } = await supabase
      .from('workflows')
      .insert({ org_id: org.orgId, stream: wf.stream, name: wf.name })
      .select('id')
      .single();
    if (error || !row) return { ok: false, error: error?.message ?? 'Could not seed workflows.' };
    const { error: taskErr } = await supabase.from('workflow_tasks').insert(
      wf.tasks.map((name) => ({
        org_id: org.orgId,
        workflow_id: row.id,
        status: 'todo',
        subtasks: [{ name }]
      }))
    );
    if (taskErr) return { ok: false, error: taskErr.message };
    created += wf.tasks.length;
  }

  revalidatePath('/run/workflows');
  revalidatePath('/run');
  return { ok: true, created };
}

/** Advance one task exactly one status step (todo → doing → done). */
export async function advanceWorkflowTask(input: {
  taskId: string;
  to: string;
}): Promise<RunOpsActionResult> {
  if (!input.taskId) return { ok: false, error: 'Missing task.' };
  if (!isTaskStatus(input.to)) return { ok: false, error: 'Invalid status.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const { data: task } = await supabase
    .from('workflow_tasks')
    .select('id, status')
    .eq('id', input.taskId)
    .eq('org_id', org.orgId)
    .maybeSingle();
  if (!task) return { ok: false, error: 'Task not found.' };

  const expected = isTaskStatus(task.status) ? nextTaskStatus(task.status as TaskStatus) : 'todo';
  if (expected !== input.to) return { ok: false, error: 'Tasks advance one step at a time.' };

  const { error } = await supabase
    .from('workflow_tasks')
    .update({ status: input.to })
    .eq('id', task.id)
    .eq('org_id', org.orgId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/run/workflows');
  return { ok: true };
}

/** Seed Adrian's compliance baseline. Once. */
export async function seedCompliance(): Promise<RunOpsActionResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const { count } = await supabase
    .from('compliance_items')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', org.orgId);
  if ((count ?? 0) > 0) return { ok: false, error: 'The compliance baseline is already set.' };

  const { error } = await supabase.from('compliance_items').insert(
    COMPLIANCE_BASELINE.map((i) => ({
      org_id: org.orgId,
      category: i.category,
      severity: i.severity,
      status: i.status,
      name: i.name,
      owner_name: i.owner,
      due_label: i.due,
      drives: i.drives,
      detail: i.detail,
      action_label: i.action,
      checklist: [...i.checklist]
    }))
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/run/compliance');
  revalidatePath('/run');
  return { ok: true, created: COMPLIANCE_BASELINE.length };
}

/** Resolve one open or upcoming compliance item. */
export async function resolveComplianceItem(itemId: string): Promise<RunOpsActionResult> {
  if (!itemId) return { ok: false, error: 'Missing item.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const { data: item } = await supabase
    .from('compliance_items')
    .select('id, status')
    .eq('id', itemId)
    .eq('org_id', org.orgId)
    .maybeSingle();
  if (!item) return { ok: false, error: 'Item not found.' };
  if (!isComplianceResolvable(item.status))
    return { ok: false, error: 'This item is already resolved.' };

  const { error } = await supabase
    .from('compliance_items')
    .update({ status: 'resolved' })
    .eq('id', item.id)
    .eq('org_id', org.orgId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/run/compliance');
  return { ok: true };
}

/** Seed Eleanor's reporting cadence. Once. */
export async function seedIr(): Promise<RunOpsActionResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const { count } = await supabase
    .from('ir_items')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', org.orgId);
  if ((count ?? 0) > 0) return { ok: false, error: 'The reporting cadence is already set.' };

  const now = Date.now();
  const { error } = await supabase.from('ir_items').insert(
    IR_BASELINE.map((i) => ({
      org_id: org.orgId,
      // Legacy column: `cat` predates the anatomy columns and carried the name.
      cat: i.name,
      name: i.name,
      category: i.category,
      who: i.who,
      drives: i.drives,
      detail: i.detail,
      contents: [...i.contents],
      status: 'todo',
      due_at: new Date(now + i.dueInDays * 86_400_000).toISOString()
    }))
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/run/ir');
  revalidatePath('/run');
  return { ok: true, created: IR_BASELINE.length };
}

/** Mark one IR deliverable sent. */
export async function markIrSent(itemId: string): Promise<RunOpsActionResult> {
  if (!itemId) return { ok: false, error: 'Missing deliverable.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const { data: item } = await supabase
    .from('ir_items')
    .select('id, status')
    .eq('id', itemId)
    .eq('org_id', org.orgId)
    .maybeSingle();
  if (!item) return { ok: false, error: 'Deliverable not found.' };
  if (item.status !== 'todo') return { ok: false, error: 'Already sent.' };

  const { error } = await supabase
    .from('ir_items')
    .update({ status: 'sent' })
    .eq('id', item.id)
    .eq('org_id', org.orgId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/run/ir');
  return { ok: true };
}
