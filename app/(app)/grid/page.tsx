import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { groupByEngine, type GridWorkflow } from "@/lib/execution-grid";
import { ExecutionGrid } from "@/components/grid/ExecutionGrid";
import { GridLive } from "@/components/grid/GridLive";

export const dynamic = "force-dynamic";

// The Execution Grid: all routed workflows (parent tasks) for the org, grouped
// into the seven engine panes by their persisted target_engine.
export default async function GridPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();
  const { data } = await supabase
    .from("tasks")
    .select("id, title, status, session_id, created_at, hub, description, lifecycle_stage, target_engine")
    .eq("organization_id", ctx.orgId)
    .is("parent_task_id", null)
    .order("created_at", { ascending: false })
    .limit(200);

  const panes = groupByEngine((data ?? []) as GridWorkflow[]);

  return (
    <>
      {/* Auto-refresh the grid as workflows are routed/progress (realtime). */}
      <GridLive orgId={ctx.orgId} />
      <ExecutionGrid panes={panes} />
    </>
  );
}
