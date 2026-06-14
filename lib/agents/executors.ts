import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { log } from '@/lib/observability/log';
import { meterAction } from '@/lib/credits/meter';
import { discoverTargets } from '@/lib/ai/target-discovery';
import { TEAM_ROSTER } from '@/lib/team';

/* ============================================================================
 * lib/agents/executors.ts — the run-executor registry (Phase 1, P1-A).
 *
 * When an operator APPROVES a proposed run on the Action Queue, the run is
 * authorized. An executor is the thing that then *does the low-stakes work* and
 * produces a deliverable — strictly inside the propose-only guardrail: no agent
 * here may send, sign, move money, or accept/reject an LP. Executors only read,
 * call an AI core, and stage follow-up work for the operator.
 *
 * Design:
 *   - `dispatchRunExecutor(runId)` is called by `decideTaskRun` AFTER the
 *     decision RPC has already committed the approval + audit row. It is
 *     therefore NEVER-BLOCK: any failure here is logged and swallowed; the
 *     approval stands regardless.
 *   - Executors register by the owning specialist's canonical roster slug.
 *     A run whose agent has no registered executor is a clean no-op (the
 *     historical "authorize only" behaviour), so adding agents is additive.
 *   - Later workstreams (P1-C memo, diligence) register their executors here
 *     the same way; nothing else changes.
 * ========================================================================= */

const VALID_SLUGS = new Set(TEAM_ROSTER.map((m) => m.slug));

/** Context handed to an executor for an approved run. */
export interface ExecutorContext {
  orgId: string;
  runId: string;
  taskId: string;
  agentSlug: string;
  taskTitle: string;
  taskDescription: string | null;
}

/** An executor performs the low-stakes deliverable for an approved run. */
type Executor = (ctx: ExecutorContext) => Promise<void>;

/* ----------------------------------------------------------------------------
 * Sourcing executor (Marcus · Head of Deal Origination).
 *
 * On approval of a sourcing run, scout on-thesis targets from the task's brief
 * (its description, falling back to the title) and stage the top candidates as
 * follow-up desk tasks routed to the specialist who should own each. Metered as
 * `target_discovery` (fail-open). Degrades cleanly when the AI key is absent or
 * the brief is empty — it simply stages nothing.
 * --------------------------------------------------------------------------*/
const MAX_STAGED_TARGETS = 3;

const sourcingExecutor: Executor = async (ctx) => {
  const thesis = (ctx.taskDescription?.trim() || ctx.taskTitle).trim();
  if (!thesis) {
    log.info('agent_executor_sourcing_skipped', { runId: ctx.runId, reason: 'empty_brief' });
    return;
  }

  // Meter before the spend. Fail-open on infra; only a real shortfall stops us.
  const meter = await meterAction(ctx.orgId, 'target_discovery', ctx.runId);
  if (!meter.ok) {
    log.info('agent_executor_sourcing_skipped', { runId: ctx.runId, reason: meter.reason });
    return;
  }

  const { configured, candidates } = await discoverTargets({ query: thesis });
  if (!configured || candidates.length === 0) {
    log.info('agent_executor_sourcing_nostage', { runId: ctx.runId, configured });
    return;
  }

  const supabase = await createClient();
  const rows = candidates.slice(0, MAX_STAGED_TARGETS).map((c) => {
    // Route to the suggested specialist when it's a real roster slug; else the
    // sourcing desk keeps ownership.
    const owner = VALID_SLUGS.has(c.routedSpecialist) ? c.routedSpecialist : 'deal-sourcer';
    const rationale = [c.fitRationale, c.suggestedOutreach].filter(Boolean).join('\n\n');
    return {
      org_id: ctx.orgId,
      agent_slug: owner,
      title: `Pursue ${c.companyName}`.slice(0, 200),
      description:
        `${c.sector} · ${c.dealType} · ${c.estValuation} · fit ${c.thesisFit}/100\n\n${rationale}`.slice(
          0,
          2000
        ),
      status: 'queued',
      source: 'agent',
      priority: 1
    };
  });

  const { error } = await supabase.from('tasks').insert(rows);
  if (error) {
    log.error('agent_executor_sourcing_stage_failed', { runId: ctx.runId, error });
    return;
  }
  log.info('agent_executor_sourcing_staged', { runId: ctx.runId, count: rows.length });
};

/** Registry: specialist slug → executor. Unlisted agents are a clean no-op. */
const REGISTRY: Record<string, Executor> = {
  'deal-sourcer': sourcingExecutor
};

/**
 * Run the executor for an approved run, if one is registered. NEVER-BLOCK:
 * called after the approval has committed, so it only reads the run for
 * context, dispatches, and swallows/logs any error. Returns silently when the
 * run isn't approved, can't be read, or has no registered executor.
 */
export async function dispatchRunExecutor(runId: string): Promise<void> {
  if (!runId) return;
  try {
    const supabase = await createClient();
    const { data: run } = await supabase
      .from('task_runs')
      .select('id, org_id, task_id, agent_slug, status')
      .eq('id', runId)
      .maybeSingle();

    if (!run || run.status !== 'approved') return;
    const executor = REGISTRY[run.agent_slug];
    if (!executor) return;

    const { data: task } = await supabase
      .from('tasks')
      .select('title, description')
      .eq('id', run.task_id)
      .maybeSingle();

    await executor({
      orgId: run.org_id,
      runId: run.id,
      taskId: run.task_id,
      agentSlug: run.agent_slug,
      taskTitle: task?.title ?? '',
      taskDescription: task?.description ?? null
    });
  } catch (error) {
    // Approval already stands; an executor failure must never surface to the
    // operator as a failed decision.
    log.error('agent_executor_dispatch_failed', { runId, error });
  }
}
