// lib/sla-cron.ts
// Automatic SLA escalation for the scheduled cron sweep. On each tick we look
// for parent workflows that have sat past their SLA (via engine-sla.isStuck)
// and haven't already been escalated, then raise a tracked, high-priority team
// task for each — so a stuck workflow surfaces even when nobody is watching the
// Execution Grid.
//
// The selector `selectEscalations` is PURE + deterministic (`now` injected) and
// unit-tested. `runSlaEscalations` is the best-effort DB wrapper that mirrors
// the team-task shape + idempotency convention of `escalateStuckWorkflow`
// (app/(app)/grid/actions.ts) and is defensive: it never throws.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TaskStatus } from "@/lib/supabase/database.types";
import { isStuck, DEFAULT_SLA_HOURS } from "@/lib/engine-sla";
import type { GridWorkflow } from "@/lib/execution-grid";
import { createTeamTask, recordOperatorFeedback } from "@/lib/team-tasks";

type Client = SupabaseClient<Database>;

// Default ceiling on escalations per sweep, mirroring the cron's own per-sweep
// cap: a sudden backlog can't flood the team queue in one tick; the next sweep
// picks up the remainder.
export const DEFAULT_ESCALATION_CAP = 20;

export interface SelectEscalationsOptions {
  thresholdHours?: number;
  cap?: number;
}

/**
 * Pure selector: the ids of workflows to auto-escalate this tick — stuck past
 * the SLA threshold (via isStuck) AND not already escalated — capped, in input
 * order. Deterministic via the injected `now`.
 */
export function selectEscalations(
  workflows: GridWorkflow[],
  alreadyEscalatedIds: Set<string>,
  now: Date,
  opts: SelectEscalationsOptions = {},
): string[] {
  const thresholdHours = opts.thresholdHours ?? DEFAULT_SLA_HOURS;
  const cap = opts.cap ?? DEFAULT_ESCALATION_CAP;
  const selected: string[] = [];
  for (const w of workflows) {
    if (selected.length >= cap) break;
    if (alreadyEscalatedIds.has(w.id)) continue;
    if (!isStuck(w, now, thresholdHours)) continue;
    selected.push(w.id);
  }
  return selected;
}

// The minimal parent-workflow shape we need from the tasks table, plus the
// owner so the cron (which has no user session) can assign the team task.
interface EscalationCandidate extends GridWorkflow {
  organization_id: string;
  created_by: string | null;
}

const ACTIVE_STATUSES: TaskStatus[] = ["awaiting_approval", "in_progress", "pending"];
const OPEN_TEAM_TASK_STATUSES: TaskStatus[] = ["pending", "in_progress", "blocked"];

// Signals that mark a workflow as already escalated — operator-initiated
// ("escalate", from the grid action) or automatic ("auto_escalate", from here).
const ESCALATED_SIGNALS = ["escalate", "auto_escalate"];

/**
 * Best-effort auto-escalation step for the cron tick. Loads active parent
 * workflows org-wide via the service client, computes the already-escalated set
 * from operator_feedback, selects via selectEscalations, and for each raises a
 * high-priority team task (same description/dedup convention as
 * escalateStuckWorkflow) plus an "auto_escalate" operator_feedback signal.
 *
 * Defensive: never throws. Returns the number of workflows escalated.
 */
export async function runSlaEscalations(supabase: Client, now: Date = new Date()): Promise<number> {
  try {
    // Active parent workflows across every org (cron has no org scope).
    const { data: taskRows } = await supabase
      .from("tasks")
      .select(
        "id, title, status, session_id, created_at, hub, description, lifecycle_stage, target_engine, organization_id, created_by",
      )
      .is("parent_task_id", null)
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: true })
      .limit(500);

    const candidates = (taskRows ?? []) as EscalationCandidate[];
    if (!candidates.length) return 0;

    // The set of workflow ids already escalated (operator- or auto-initiated).
    const { data: feedbackRows } = await supabase
      .from("operator_feedback")
      .select("task_id")
      .in("signal", ESCALATED_SIGNALS)
      .not("task_id", "is", null)
      .limit(2000);
    const alreadyEscalated = new Set<string>(
      (feedbackRows ?? [])
        .map((r) => (r as { task_id: string | null }).task_id)
        .filter((id): id is string => !!id),
    );

    const ids = selectEscalations(candidates, alreadyEscalated, now);
    if (!ids.length) return 0;

    const byId = new Map(candidates.map((c) => [c.id, c]));
    let escalated = 0;

    for (const id of ids) {
      const wf = byId.get(id);
      if (!wf) continue;
      // Without an owner there's no one to assign the task to; skip (the grid
      // action requires a signed-in user for the same reason).
      const owner = wf.created_by;
      if (!owner) continue;

      // Belt-and-suspenders idempotency, mirroring escalateStuckWorkflow: skip
      // if an open team_task already references this workflow id. The feedback
      // set above is the primary guard; this also covers escalations whose
      // feedback row failed to write.
      const { data: existing } = await supabase
        .from("team_tasks")
        .select("id")
        .eq("organization_id", wf.organization_id)
        .in("status", OPEN_TEAM_TASK_STATUSES)
        .ilike("description", `%${wf.id}%`)
        .limit(1);
      if (existing && existing.length > 0) continue;

      const title = wf.title ?? "workflow";
      const sessionLink = wf.session_id ? ` Session: /session/${wf.session_id}.` : "";
      const description =
        `This workflow breached its SLA and is stuck in the Execution Grid.` +
        `${sessionLink} Workflow id: ${wf.id}.`;

      const created = await createTeamTask(supabase, {
        organizationId: wf.organization_id,
        assignedTo: owner,
        assignedBy: owner,
        title: `Stuck: ${title}`,
        description,
        hub: wf.hub ?? null,
        module: "grid",
        priority: "high",
        sessionId: wf.session_id ?? null,
        sourceTaskId: wf.id,
        contextSnapshot: { workflow_id: wf.id, reason: "sla_breach", source: "cron" },
      });
      if (!created) continue;

      await recordOperatorFeedback(supabase, [
        {
          organizationId: wf.organization_id,
          principalId: null,
          signal: "auto_escalate",
          subject: title,
          scope: "execution_grid",
          module: "grid",
          taskId: wf.id,
          sessionId: wf.session_id ?? null,
          metadata: { workflow_id: wf.id, reason: "sla_breach", source: "cron" },
        },
      ]);

      escalated += 1;
    }

    return escalated;
  } catch {
    return 0;
  }
}
