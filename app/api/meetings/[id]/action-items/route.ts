// app/api/meetings/[id]/action-items/route.ts
// Ticking off an action item on the report page.
//
// Every action item already becomes a task (lib/meetings/action-items.server.ts),
// but the report showed them as a list of text with a checkbox character in
// front — something that looked like it could be ticked and could not. This is
// the tick: it completes, or reopens, the task the item became, so the report and
// the task list say the same thing.
import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { updateTeamTaskStatus } from "@/lib/team-tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `PATCH /api/meetings/:id/action-items` with `{ taskId, done }`
 *
 * The meeting's host, or the person the task is assigned to. Anybody else in
 * the organisation can read the report; closing out somebody else's commitment
 * from it is not theirs to do.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const payload = (await req.json().catch(() => ({}))) as { taskId?: unknown; done?: unknown };
  const taskId = typeof payload?.taskId === "string" ? payload.taskId.trim() : "";
  if (!taskId || typeof payload?.done !== "boolean") {
    return NextResponse.json({ error: "taskId and done are required" }, { status: 400 });
  }

  const supabase = await createServerClient();

  const [{ data: meeting }, { data: task }] = await Promise.all([
    supabase.from("live_meetings").select("id, host_id").eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase
      .from("team_tasks")
      .select("id, organization_id, assigned_to, meeting_id")
      .eq("id", taskId)
      .eq("meeting_id", id)
      .maybeSingle(),
  ]);

  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  if (!task) return NextResponse.json({ error: "That action item has no task on this meeting." }, { status: 404 });

  const row = task as { organization_id: string; assigned_to: string | null };
  const userId = auth.ctx.userId;
  if (meeting.host_id !== userId && row.assigned_to !== userId) {
    return NextResponse.json(
      { error: "Only the host or the person it is assigned to can change this item." },
      { status: 403 },
    );
  }

  const result = await updateTeamTaskStatus(supabase as never, {
    organizationId: row.organization_id,
    taskId,
    status: payload.done ? "completed" : "pending",
  });
  if (!result.ok) return NextResponse.json({ error: "The item could not be updated." }, { status: 500 });

  return NextResponse.json({ ok: true, done: payload.done });
}
