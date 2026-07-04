import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import type { AgentKey } from "@/lib/supabase/database.types";

// GET /api/agents — list the agent catalog with current per-agent workload
// (count of active tasks in the org).
export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = await createServerClient();
  const [agents, activeTasks] = await Promise.all([
    supabase.from("ai_agents").select("*"),
    supabase
      .from("tasks")
      .select("assigned_agent")
      .eq("organization_id", auth.ctx.orgId)
      .in("status", ["pending", "in_progress", "awaiting_approval", "blocked"]),
  ]);

  const workload = new Map<AgentKey, number>();
  for (const t of activeTasks.data ?? []) {
    workload.set(t.assigned_agent, (workload.get(t.assigned_agent) ?? 0) + 1);
  }

  const result = (agents.data ?? []).map((a) => ({
    ...a,
    active_tasks: workload.get(a.key) ?? 0,
  }));
  return NextResponse.json({ agents: result });
}
