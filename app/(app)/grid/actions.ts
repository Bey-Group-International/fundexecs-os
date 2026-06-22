"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { createTeamTask, recordOperatorFeedback } from "@/lib/team-tasks";
import {
  isTargetEngine,
  engineForStage,
  LIFECYCLE_STAGES,
  type TargetEngine,
  type LifecycleStage,
} from "@/lib/intelligence";

// The Execution Grid buckets a workflow by the engine its lifecycle_stage maps
// to (engineOfWorkflow → engineForStage). So re-routing to an engine means
// re-stamping the stage to a representative one for that engine, keeping the
// stage and the persisted target_engine column consistent.
function representativeStage(engine: TargetEngine): LifecycleStage {
  return LIFECYCLE_STAGES.find((s) => engineForStage(s) === engine) ?? LIFECYCLE_STAGES[0];
}

/**
 * Operator feedback loop: correct a misrouted workflow by moving it to a
 * different engine. Updates the workflow's routing and records the correction
 * in operator_feedback (signal "reroute") — the dataset that future
 * classification can learn from. Authoritative human override of the AI route.
 */
export async function rerouteWorkflow(
  workflowId: string,
  toEngine: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { ok: false, error: "Not signed in." };
  if (!isTargetEngine(toEngine)) return { ok: false, error: "Unknown engine." };

  const supabase = createServerClient();
  const { data: wf } = await supabase
    .from("tasks")
    .select("id, target_engine, session_id, title")
    .eq("id", workflowId)
    .eq("organization_id", ctx.orgId)
    .is("parent_task_id", null)
    .maybeSingle();
  if (!wf) return { ok: false, error: "Workflow not found." };

  const from = wf.target_engine ?? "(unrouted)";
  if (from === toEngine) return { ok: true };

  const stage = representativeStage(toEngine);
  const { error } = await supabase
    .from("tasks")
    .update({ lifecycle_stage: stage, target_engine: toEngine })
    .eq("id", workflowId)
    .eq("organization_id", ctx.orgId);
  if (error) return { ok: false, error: "Could not re-route." };

  await recordOperatorFeedback(supabase, [
    {
      organizationId: ctx.orgId,
      principalId: ctx.userId,
      signal: "reroute",
      subject: `${from} → ${toEngine}`,
      scope: "execution_grid",
      module: "grid",
      taskId: workflowId,
      sessionId: wf.session_id ?? null,
      metadata: { from_engine: from, to_engine: toEngine, lifecycle_stage: stage, title: wf.title },
    },
  ]);

  revalidatePath("/grid");
  return { ok: true };
}

/**
 * Escalate a stuck workflow into a tracked team task so it isn't forgotten.
 * Best-effort and defensive: never throws to the caller. Idempotent — if an
 * open team_task already references this workflow, it does nothing. Also logs
 * an "escalate" operator-feedback signal for the learning dataset.
 */
export async function escalateStuckWorkflow(
  workflowId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { ok: false, error: "Not signed in." };

    const supabase = createServerClient();
    const { data: wf } = await supabase
      .from("tasks")
      .select("id, title, hub, session_id")
      .eq("id", workflowId)
      .eq("organization_id", ctx.orgId)
      .is("parent_task_id", null)
      .maybeSingle();
    if (!wf) return { ok: false, error: "Workflow not found." };

    // Best-effort idempotency: bail if an open team_task already references this
    // workflow id (in its description). Active statuses mirror team-tasks.
    const { data: existing } = await supabase
      .from("team_tasks")
      .select("id")
      .eq("organization_id", ctx.orgId)
      .in("status", ["pending", "in_progress", "blocked"])
      .ilike("description", `%${workflowId}%`)
      .limit(1);
    if (existing && existing.length > 0) return { ok: true };

    const title = wf.title ?? "workflow";
    const sessionLink = wf.session_id ? ` Session: /session/${wf.session_id}.` : "";
    const description =
      `This workflow breached its SLA and is stuck in the Execution Grid.` +
      `${sessionLink} Workflow id: ${workflowId}.`;

    await createTeamTask(supabase, {
      organizationId: ctx.orgId,
      assignedTo: ctx.userId,
      assignedBy: ctx.userId,
      title: `Stuck: ${title}`,
      description,
      hub: wf.hub ?? null,
      module: "grid",
      priority: "high",
      sessionId: wf.session_id ?? null,
      sourceTaskId: workflowId,
      contextSnapshot: { workflow_id: workflowId, reason: "sla_breach" },
    });

    await recordOperatorFeedback(supabase, [
      {
        organizationId: ctx.orgId,
        principalId: ctx.userId,
        signal: "escalate",
        subject: title,
        scope: "execution_grid",
        module: "grid",
        taskId: workflowId,
        sessionId: wf.session_id ?? null,
        metadata: { workflow_id: workflowId },
      },
    ]);

    revalidatePath("/grid");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not escalate." };
  }
}
