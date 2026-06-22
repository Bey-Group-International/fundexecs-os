import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";

// GET /api/report?task_id=... — retrieve a task's full record: the task, its
// events, approvals, and handoffs. The "output and analytics" endpoint.
export async function GET(request: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const taskId = new URL(request.url).searchParams.get("task_id");
  if (!taskId) {
    return NextResponse.json({ error: "Required: task_id" }, { status: 400 });
  }

  const supabase = createServerClient();
  // RLS already scopes every query below to the caller's org; the explicit
  // organization_id filter on the keystone lookup is defense-in-depth so a
  // future RLS regression can't turn this into a cross-org task read.
  const [task, events, approvals, handoffs, artifacts] = await Promise.all([
    supabase
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .eq("organization_id", auth.ctx.orgId)
      .maybeSingle(),
    supabase
      .from("task_events")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true }),
    supabase.from("approvals").select("*").eq("task_id", taskId),
    supabase.from("task_handoffs").select("*").eq("task_id", taskId),
    supabase
      .from("artifacts")
      .select("*")
      .eq("workflow_id", taskId)
      .order("created_at", { ascending: true }),
  ]);

  if (!task.data) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({
    task: task.data,
    events: events.data ?? [],
    approvals: approvals.data ?? [],
    handoffs: handoffs.data ?? [],
    artifacts: artifacts.data ?? [],
  });
}
