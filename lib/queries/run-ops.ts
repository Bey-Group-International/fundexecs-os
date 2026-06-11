import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { ComplianceSeverity, IrStatus, TaskStatus } from '@/lib/run-ops/vocabulary';

/**
 * Read side of the Run interiors (workflows / compliance / IR). RLS-scoped;
 * degrades to empty on failure. One request-cached load per surface.
 */

export interface TaskView {
  id: string;
  name: string;
  status: TaskStatus | string;
}

export interface WorkflowGroup {
  id: string;
  stream: string;
  name: string;
  tasks: TaskView[];
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
      .select('id, workflow_id, status, subtasks, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true })
  ]);

  const byWorkflow = new Map<string, TaskView[]>();
  for (const t of tasks ?? []) {
    if (!byWorkflow.has(t.workflow_id)) byWorkflow.set(t.workflow_id, []);
    const first = Array.isArray(t.subtasks) ? t.subtasks[0] : null;
    const name =
      first && typeof first === 'object' && 'name' in first && typeof first.name === 'string'
        ? first.name
        : 'Task';
    byWorkflow.get(t.workflow_id)!.push({ id: t.id, name, status: t.status });
  }

  return (workflows ?? []).map((w) => ({
    id: w.id,
    stream: w.stream,
    name: w.name,
    tasks: byWorkflow.get(w.id) ?? []
  }));
});

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
