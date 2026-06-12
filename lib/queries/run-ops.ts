import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { parseLpMeta } from '@/lib/pipeline/lp-meta';
import { normalizeLpStage } from '@/lib/pipeline/lp-stages';
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
  /** Deliverable name (legacy rows fall back to the old `cat` column). */
  name: string;
  /** Prototype category (Letters / Statements / Events / Portal), when known. */
  category: string | null;
  /** The specialist who assembles it, when recorded. */
  who: string | null;
  /** Why it matters — the drives-line, when recorded. */
  drives: string | null;
  /** Drawer explanation paragraph, when recorded. */
  detail: string | null;
  /** The contents checklist; empty for legacy rows. */
  contents: string[];
  status: IrStatus | string;
  dueAt: string | null;
}

export const getIrItems = cache(async (orgId: string): Promise<IrItemView[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('ir_items')
    .select('id, cat, name, category, who, drives, detail, contents, status, due_at')
    .eq('org_id', orgId)
    .order('due_at', { ascending: true, nullsFirst: false });
  return (data ?? []).map((i) => ({
    id: i.id,
    name: i.name ?? i.cat,
    category: i.category,
    who: i.who,
    drives: i.drives,
    detail: i.detail,
    contents: Array.isArray(i.contents)
      ? i.contents.filter((c): c is string => typeof c === 'string')
      : [],
    status: i.status,
    dueAt: i.due_at
  }));
});

/** One committed investor on the IR engagement roster — real signals only. */
export interface IrLpView {
  id: string;
  name: string;
  /** Capital types joined for display; null when none recorded. */
  type: string | null;
  /** Warm/Hot/Cold relationship temperature, when recorded. */
  warmth: string | null;
  /** Human-readable last-touch note, when recorded. */
  lastTouch: string | null;
}

/**
 * The LP engagement roster: committed investors from `capital_providers`
 * (the same board the Capital Map works), with the AI-enriched warmth and
 * last-touch signals parsed honestly — missing signals stay null.
 */
export const getIrLpRoster = cache(async (orgId: string): Promise<IrLpView[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('capital_providers')
    .select('id, name, status, capital_types, criteria, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  return (data ?? [])
    .filter((row) => normalizeLpStage(row.status) === 'committed')
    .map((row) => {
      const meta = parseLpMeta(row.criteria);
      return {
        id: row.id,
        name: row.name,
        type: row.capital_types?.length ? row.capital_types.join(' · ') : null,
        warmth: meta.warmth,
        lastTouch: meta.lastTouch
      };
    });
});

/**
 * The fund performance snapshot — what LPs check first. Every figure is
 * computed from real capital records (the capital stack roll-up plus the
 * capital account ledger) or stays null; net IRR is null until a cash-flow
 * IRR exists. Nothing here is ever synthesized.
 */
export interface IrPerfView {
  /** Net IRR — null until a cash-flow IRR is computed from fund records. */
  netIrr: number | null;
  /** (NAV + distributed) / called, when a NAV balance and calls exist. */
  tvpi: number | null;
  /** Distributed / called, when both exist. */
  dpi: number | null;
  /** Latest capital-account balance, in dollars. */
  nav: number | null;
}

export const getIrPerformance = cache(async (orgId: string): Promise<IrPerfView> => {
  const empty: IrPerfView = { netIrr: null, tvpi: null, dpi: null, nav: null };
  try {
    const supabase = await createClient();
    const [stackResult, entriesResult] = await Promise.all([
      supabase.rpc('capital_stack_summary', { _org_id: orgId }),
      supabase
        .from('capital_account_entries')
        .select('entry_type, amount, balance_after')
        .eq('org_id', orgId)
        .order('entry_date', { ascending: true })
    ]);
    if (stackResult.error || entriesResult.error) return empty;

    const stack = Array.isArray(stackResult.data)
      ? (stackResult.data[0] ?? null)
      : (stackResult.data ?? null);
    const called = Number(stack?.closed_total ?? 0);

    let distributed = 0;
    let nav: number | null = null;
    for (const entry of entriesResult.data ?? []) {
      if (entry.entry_type === 'distribution') distributed += Math.abs(Number(entry.amount));
      if (entry.balance_after !== null) nav = Number(entry.balance_after);
    }

    return {
      netIrr: null,
      tvpi: called > 0 && nav !== null ? (nav + distributed) / called : null,
      dpi: called > 0 && distributed > 0 ? distributed / called : null,
      nav
    };
  } catch {
    return empty;
  }
});
