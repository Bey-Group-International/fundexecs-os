import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { engineFromSlug, engineOfWorkflow, type GridWorkflow } from "@/lib/execution-grid";
import { EnginePaneView } from "@/components/grid/EnginePaneView";
import { GridLive } from "@/components/grid/GridLive";

export const dynamic = "force-dynamic";

// Per-engine drill-down: every routed workflow (parent task) for the org that
// the Intelligence Layer sent to this one engine, with a status breakdown.
export default async function GridEnginePage(props: { params: Promise<{ engine: string }> }) {
  const params = await props.params;
  const engine = engineFromSlug(params.engine);
  if (!engine) redirect("/grid");

  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = await createServerClient();
  const { data } = await supabase
    .from("tasks")
    .select("id, title, status, session_id, created_at, hub, description, lifecycle_stage, target_engine")
    .eq("organization_id", ctx.orgId)
    .is("parent_task_id", null)
    .order("created_at", { ascending: false })
    .limit(200);

  const workflows = ((data ?? []) as GridWorkflow[]).filter((w) => engineOfWorkflow(w) === engine);

  // Compute "now" on the server so SLA / stuck-workflow flags are deterministic
  // and don't drift with the client clock.
  const now = new Date().toISOString();

  return (
    <>
      <GridLive orgId={ctx.orgId} />
      <EnginePaneView engine={engine} workflows={workflows} now={now} />
    </>
  );
}
