"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { recordOperatorFeedback } from "@/lib/team-tasks";
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
