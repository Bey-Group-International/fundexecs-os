import type { createServerClient } from "@/lib/supabase/server";
import type { Task, Approval, Artifact } from "@/lib/supabase/database.types";
import type { WorkflowBundle } from "@/components/Copilot";

type ServerClient = ReturnType<typeof createServerClient>;

// Loads the workflow bundles (workflow + steps + artifacts + latest approval)
// the Earn copilot renders. Shared by the workspace home and per-session views.
// When `sessionId` is provided the result is scoped to that session; otherwise
// it spans the whole org (the workspace's "earlier workflows" history).
export async function loadWorkflowBundles(
  supabase: ServerClient,
  opts: { sessionId?: string; limit?: number } = {},
): Promise<WorkflowBundle[]> {
  let query = supabase
    .from("tasks")
    .select("*")
    .is("parent_task_id", null)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 8);
  if (opts.sessionId) query = query.eq("session_id", opts.sessionId);

  const { data: workflows } = await query;
  const workflowList = (workflows ?? []) as Task[];
  const ids = workflowList.map((w) => w.id);
  if (ids.length === 0) return [];

  const [stepsRes, approvalsRes, artifactsRes] = await Promise.all([
    supabase.from("tasks").select("*").in("parent_task_id", ids).order("step_order", { ascending: true }),
    supabase.from("approvals").select("*").in("task_id", ids),
    supabase.from("artifacts").select("*").in("workflow_id", ids),
  ]);

  const steps = (stepsRes.data ?? []) as Task[];
  const approvals = (approvalsRes.data ?? []) as Approval[];
  const artifacts = (artifactsRes.data ?? []) as Artifact[];

  return workflowList.map((workflow) => ({
    workflow,
    steps: steps.filter((s) => s.parent_task_id === workflow.id),
    artifacts: artifacts.filter((a) => a.workflow_id === workflow.id),
    // most recent pending approval for the workflow, else latest
    approval:
      approvals
        .filter((a) => a.task_id === workflow.id)
        .sort((a, b) => (a.decision === "pending" ? -1 : 1))[0] ?? null,
  }));
}
