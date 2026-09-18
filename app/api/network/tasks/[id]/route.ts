// PATCH /api/network/tasks/[id] — complete, reopen, reschedule, or reassign a
// follow-up. Completing one also writes it onto the contact's timeline, so the
// record shows the follow-up was actually done rather than only that it existed.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { recordNetworkAudit } from "@/lib/network-audit";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const PRIORITIES = ["low", "normal", "high"];
const STATUSES = ["open", "done", "cancelled"];

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const payload = (await req.json().catch(() => null)) as {
    status?: string;
    title?: string;
    notes?: string | null;
    dueAt?: string | null;
    priority?: string;
    assigneeId?: string | null;
  } | null;

  if (!payload) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  const supabase = (await createServerClient()) as any;

  const { data: before } = await supabase
    .from("network_tasks")
    .select("id, title, status, contact_id")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const patch: Record<string, unknown> = {};

  if (payload.status !== undefined) {
    if (!STATUSES.includes(payload.status)) {
      return NextResponse.json({ error: "Unknown status." }, { status: 400 });
    }
    patch.status = payload.status;
    // completed_at tracks the status rather than being set independently, so a
    // reopened task cannot keep a completion date it no longer has.
    patch.completed_at = payload.status === "done" ? new Date().toISOString() : null;
  }
  if (payload.title !== undefined) {
    const title = payload.title.trim();
    if (!title) return NextResponse.json({ error: "title cannot be empty." }, { status: 400 });
    patch.title = title.slice(0, 300);
  }
  if (payload.notes !== undefined) patch.notes = payload.notes?.slice(0, 5_000) ?? null;
  if (payload.priority !== undefined) {
    if (!PRIORITIES.includes(payload.priority)) {
      return NextResponse.json({ error: "Unknown priority." }, { status: 400 });
    }
    patch.priority = payload.priority;
  }
  if (payload.dueAt !== undefined) {
    if (payload.dueAt === null) patch.due_at = null;
    else {
      const ms = Date.parse(payload.dueAt);
      if (Number.isNaN(ms)) {
        return NextResponse.json({ error: "dueAt must be a valid date." }, { status: 400 });
      }
      patch.due_at = new Date(ms).toISOString();
    }
  }
  if (payload.assigneeId !== undefined) patch.assignee_id = payload.assigneeId;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("network_tasks")
    .update(patch)
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", id)
    .select("id, title, notes, due_at, priority, status, assignee_id, contact_id, completed_at, created_at")
    .single();

  if (error || !data) {
    console.error("[network/tasks] update", error);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }

  if (patch.status === "done" && before.status !== "done" && data.contact_id) {
    const { error: logError } = await supabase.from("network_activities").insert({
      organization_id: auth.ctx.orgId,
      contact_id: data.contact_id,
      actor_id: auth.ctx.userId,
      activity_type: "task",
      subject: `Completed: ${data.title}`,
      is_system: true,
      metadata: { taskId: data.id },
    });
    if (logError) console.warn("[network/tasks] timeline entry failed", logError);
  }

  await recordNetworkAudit(supabase, {
    orgId: auth.ctx.orgId,
    actorId: auth.ctx.userId,
    action: "update",
    entityType: "network_task",
    entityId: id,
    entityLabel: before.title ?? null,
    metadata: { fields: Object.keys(patch) },
  });

  return NextResponse.json({
    task: {
      id: data.id,
      title: data.title,
      notes: data.notes ?? null,
      dueAt: data.due_at ?? null,
      priority: data.priority,
      status: data.status,
      assigneeId: data.assignee_id ?? null,
      contactId: data.contact_id ?? null,
      completedAt: data.completed_at ?? null,
      createdAt: data.created_at,
      overdue: data.status === "open" && data.due_at ? Date.parse(data.due_at) < Date.now() : false,
    },
  });
}
