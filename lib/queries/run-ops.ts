import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { ComplianceSeverity, IrStatus, TaskStatus } from '@/lib/run-ops/vocabulary';

/**
 * Read side of the Run interiors (workflows / compliance / IR). RLS-scoped;
 * degrades to empty on failure. One request-cached load per surface.
 */

export interface SubtaskView {
  name: string;
  done: boolean;
}

export interface TaskView {
  id: string;
  name: string;
  status: TaskStatus | string;
  who: string | null;
  drives: string | null;
  action: string | null;
  dueLabel: string | null;
  critical: boolean;
  sub: SubtaskView[];
}

export interface WorkflowGroup {
  id: string;
  stream: string;
  name: string;
  tasks: TaskView[];
}

function parseSubtasks(raw: unknown): SubtaskView[] {
  if (!Array.isArray(raw)) return [];
  const subs: SubtaskView[] = [];
  for (const entry of raw) {
    if (entry && typeof entry === 'object' && 'name' in entry && typeof entry.name === 'string') {
      subs.push({ name: entry.name, done: 'done' in entry && entry.done === true });
    }
  }
  return subs;
}

export const getWorkflows = cache(async (orgId: string): Promise<WorkflowGroup[]> => {
  const supabase = await createClient();
  const [{ data: workflows }, { data: tasks }] = await Promise.all([
    supabase
      .from('workflows')
      .select('id, stream, name')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true }),
    supabase
      .from('workflow_tasks')
      .select('id, workflow_id, status, subtasks, name, who, drives, action, due_label, critical')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true })
  ]);

  const byWorkflow = new Map<string, TaskView[]>();
  for (const t of tasks ?? []) {
    if (!byWorkflow.has(t.workflow_id)) byWorkflow.set(t.workflow_id, []);
    const subs = parseSubtasks(t.subtasks);
    // Pre-anatomy rows kept the task name as the only subtasks entry; honor
    // that shape as a fallback rather than rendering a bogus checklist.
    const legacyNameHolder = !t.name && subs.length === 1;
    byWorkflow.get(t.workflow_id)!.push({
      id: t.id,
      name: t.name ?? (legacyNameHolder ? subs[0].name : 'Task'),
      status: t.status,
      who: t.who,
      drives: t.drives,
      action: t.action,
      dueLabel: t.due_label,
      critical: Boolean(t.critical),
      sub: legacyNameHolder ? [] : subs
    });
  }

  return (workflows ?? []).map((w) => ({
    id: w.id,
    stream: w.stream,
    name: w.name,
    tasks: byWorkflow.get(w.id) ?? []
  }));
});

export interface AutomationState {
  enabled: boolean;
  lastRunAt: string | null;
}

/** Persisted org-scoped automation toggles, keyed by automations.on_event. */
export const getWorkflowAutomations = cache(
  async (orgId: string): Promise<Record<string, AutomationState>> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from('automations')
      .select('on_event, enabled, last_run_at, updated_at')
      .eq('org_id', orgId)
      .order('updated_at', { ascending: true });
    const states: Record<string, AutomationState> = {};
    for (const row of data ?? []) {
      states[row.on_event] = { enabled: row.enabled, lastRunAt: row.last_run_at };
    }
    return states;
  }
);

export interface ComplianceItemView {
  id: string;
  category: string;
  severity: ComplianceSeverity | string;
  status: string;
}

export const getComplianceItems = cache(async (orgId: string): Promise<ComplianceItemView[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('compliance_items')
    .select('id, category, severity, status')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  return (data ?? []) as ComplianceItemView[];
});

export interface IrItemView {
  id: string;
  cat: string;
  status: IrStatus | string;
  dueAt: string | null;
}

export const getIrItems = cache(async (orgId: string): Promise<IrItemView[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('ir_items')
    .select('id, cat, status, due_at')
    .eq('org_id', orgId)
    .order('due_at', { ascending: true, nullsFirst: false });
  return (data ?? []).map((i) => ({ id: i.id, cat: i.cat, status: i.status, dueAt: i.due_at }));
});
