import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getMemberOrCOO } from '@/lib/team';

/* ============================================================================
 * lib/queries/action-queue.ts — the operator's review queue.
 *
 * The Action Queue is the first-class home for every pending run proposal a
 * specialist has raised across the desk. Where the Team-tasks board shows one
 * proposal in the context of its owning agent card, this surface aggregates
 * ALL open proposals (`task_runs.status = 'proposed'`) into a single
 * approve / reject worklist — the spine of the propose → approve → audit loop.
 *
 * Read-only and RLS-scoped (org members see only their org's runs); fails soft
 * to an empty list so the surface never hard-errors.
 * ========================================================================= */

/** A single pending proposal, enriched with its task + owning specialist. */
export interface PendingRun {
  runId: string;
  taskId: string;
  /** Canonical roster slug of the specialist who raised the proposal. */
  agentSlug: string;
  /** Display name of that specialist (resolved from the frozen roster). */
  agentName: string;
  /** The specialist's position (e.g. "Head of Deal Origination"). */
  agentPosition: string;
  /** The task this proposal acts on. */
  taskTitle: string;
  taskDescription: string | null;
  /** One-line action shown on the confirm card. */
  action: string;
  /** Ordered plan steps. */
  steps: string[];
  /** ISO timestamp the proposal was raised. */
  proposedAt: string;
}

/**
 * Every open proposal for the org, newest first, enriched with task + agent.
 * Two small reads (runs, then the tasks they reference) keep this provider
 * agnostic and avoid depending on a DB join view.
 */
export async function getPendingRuns(orgId: string): Promise<PendingRun[]> {
  const supabase = await createClient();

  const { data: runs, error } = await supabase
    .from('task_runs')
    .select('id, task_id, agent_slug, action, steps, created_at')
    .eq('org_id', orgId)
    .eq('status', 'proposed')
    .order('created_at', { ascending: false });

  if (error || !runs || runs.length === 0) return [];

  // Resolve the referenced tasks in one read; map for O(1) lookup.
  const taskIds = Array.from(new Set(runs.map((r) => r.task_id)));
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, description')
    .eq('org_id', orgId)
    .in('id', taskIds);

  const taskById = new Map((tasks ?? []).map((t) => [t.id, t] as const));

  return runs.map((r) => {
    const member = getMemberOrCOO(r.agent_slug);
    const task = taskById.get(r.task_id);
    const steps = Array.isArray(r.steps) ? (r.steps as unknown[]).map(String) : [];
    return {
      runId: r.id,
      taskId: r.task_id,
      agentSlug: r.agent_slug,
      agentName: member.name,
      agentPosition: member.position,
      taskTitle: task?.title ?? 'Untitled task',
      taskDescription: task?.description ?? null,
      action: r.action,
      steps,
      proposedAt: r.created_at
    };
  });
}
