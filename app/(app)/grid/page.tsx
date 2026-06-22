import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { groupByEngine, type GridWorkflow } from "@/lib/execution-grid";
import { engineAnalytics, type AnalyticsWorkflow } from "@/lib/grid-analytics";
import { ExecutionGrid } from "@/components/grid/ExecutionGrid";
import { EngineAnalytics } from "@/components/grid/EngineAnalytics";
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
    .select("id, title, status, session_id, created_at, completed_at, hub, description, lifecycle_stage, target_engine")
    .eq("organization_id", ctx.orgId)
    .is("parent_task_id", null)
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as AnalyticsWorkflow[];
  const panes = groupByEngine(rows as GridWorkflow[]);
  const analytics = engineAnalytics(rows);

  return (
    <>
      {/* Auto-refresh the grid as workflows are routed/progress (realtime). */}
      <GridLive orgId={ctx.orgId} />
      <EngineAnalytics analytics={analytics} />
      <ExecutionGrid panes={panes} />
    </>
  );
}
