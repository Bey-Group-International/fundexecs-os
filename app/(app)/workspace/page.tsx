import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { AGENTS } from "@/lib/agents";
import Workspace from "@/components/Workspace";
import type { AgentKey } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();
  const [tasks, approvals, events] = await Promise.all([
    supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase.from("approvals").select("*").eq("decision", "pending"),
    supabase
      .from("task_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  // Per-agent active workload, computed from the loaded tasks.
  const activeStatuses = new Set([
    "pending",
    "in_progress",
    "awaiting_approval",
    "blocked",
  ]);
  const workload = new Map<AgentKey, number>();
  for (const t of tasks.data ?? []) {
    if (activeStatuses.has(t.status)) {
      workload.set(t.assigned_agent, (workload.get(t.assigned_agent) ?? 0) + 1);
    }
  }
  const agents = AGENTS.map((a) => ({
    key: a.key,
    name: a.name,
    color: a.color,
    active_tasks: workload.get(a.key) ?? 0,
  }));

  return (
    <Workspace
      orgId={ctx.orgId}
      initialTasks={tasks.data ?? []}
      pendingApprovals={approvals.data ?? []}
      initialEvents={events.data ?? []}
      agents={agents}
    />
  );
}
