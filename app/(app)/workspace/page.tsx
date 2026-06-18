import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { copilotLive } from "@/lib/claude";
import Copilot, { type WorkflowBundle } from "@/components/Copilot";
import type { Task, Approval, Artifact } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();

  const { data: workflows } = await supabase
    .from("tasks")
    .select("*")
    .is("parent_task_id", null)
    .order("created_at", { ascending: false })
    .limit(8);

  const workflowList = (workflows ?? []) as Task[];
  const ids = workflowList.map((w) => w.id);

  const [stepsRes, approvalsRes, artifactsRes] = await Promise.all([
    ids.length
      ? supabase.from("tasks").select("*").in("parent_task_id", ids).order("step_order", { ascending: true })
      : Promise.resolve({ data: [] as Task[] }),
    ids.length
      ? supabase.from("approvals").select("*").in("task_id", ids)
      : Promise.resolve({ data: [] as Approval[] }),
    ids.length
      ? supabase.from("artifacts").select("*").in("workflow_id", ids)
      : Promise.resolve({ data: [] as Artifact[] }),
  ]);

  const steps = (stepsRes.data ?? []) as Task[];
  const approvals = (approvalsRes.data ?? []) as Approval[];
  const artifacts = (artifactsRes.data ?? []) as Artifact[];

  const bundles: WorkflowBundle[] = workflowList.map((workflow) => ({
    workflow,
    steps: steps.filter((s) => s.parent_task_id === workflow.id),
    artifacts: artifacts.filter((a) => a.workflow_id === workflow.id),
    // most recent pending approval for the workflow, else latest
    approval:
      approvals
        .filter((a) => a.task_id === workflow.id)
        .sort((a, b) => (a.decision === "pending" ? -1 : 1))[0] ?? null,
  }));

  return <Copilot orgId={ctx.orgId} live={copilotLive()} bundles={bundles} />;
}
