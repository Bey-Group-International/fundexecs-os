// POST /api/gamification/award
// Called client-side (or from streaming endpoints) the moment a team_task
// transitions to "completed". Returns the full reward payload so the UI can
// fire the CreditPopup micro-animation without a separate data fetch.
//
// Security: session-authenticated, org-scoped. The org from the session is
// used — the request body cannot override it to award credits to a different
// org. The task is verified to belong to this org before awarding.

import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { awardTaskCompletion, baseCredits } from "@/lib/gamification";
import type { Hub, TeamTaskPriority } from "@/lib/supabase/database.types";

interface AwardBody {
  taskId: string;
}

export async function POST(req: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: AwardBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.taskId || typeof body.taskId !== "string") {
    return NextResponse.json({ error: "taskId required" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Fetch the task to verify ownership and get hub/priority
  const { data: task, error: taskError } = await supabase
    .from("team_tasks")
    .select("id, organization_id, hub, priority, status")
    .eq("id", body.taskId)
    .eq("organization_id", auth.ctx.orgId)
    .maybeSingle();

  if (taskError || !task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (task.status !== "completed") {
    return NextResponse.json({ error: "Task is not completed" }, { status: 400 });
  }

  // Check whether credits were already awarded for this task (idempotency guard)
  // We store the task id in the ledger note — any matching row means already processed.
  const { count } = await supabase
    .from("credit_ledger")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", auth.ctx.orgId)
    .eq("reason", "task_complete")
    .ilike("note", `%${body.taskId}%`);

  if ((count ?? 0) > 0) {
    return NextResponse.json({ alreadyAwarded: true });
  }

  const hub      = (task.hub      as Hub)              ?? "build";
  const priority = (task.priority as TeamTaskPriority) ?? "normal";

  const payload = await awardTaskCompletion({
    orgId:  auth.ctx.orgId,
    taskId: body.taskId,
    hub,
    priority,
  });

  if (!payload) {
    return NextResponse.json({ error: "Reward processing failed" }, { status: 500 });
  }

  return NextResponse.json({ reward: payload });
}
