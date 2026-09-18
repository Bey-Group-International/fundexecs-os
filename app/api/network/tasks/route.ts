// Follow-up tasks against relationships.
//
//   GET  — the work queue: open tasks, soonest first, optionally scoped to one
//          contact or one assignee. This is what turns "we should call them
//          back" into something with a name and a date on it.
//   POST — create a task.
//
// A task always belongs to a relationship, which is the difference between this
// and a general to-do list: the queue and the record are the same data.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { loadPrincipalNames } from "@/lib/network-contact";
import { recordNetworkAudit } from "@/lib/network-audit";

export const dynamic = "force-dynamic";

const PRIORITIES = ["low", "normal", "high"];
const STATUSES = ["open", "done", "cancelled"];

export async function GET(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sp = req.nextUrl.searchParams;
  const status = STATUSES.includes(sp.get("status") ?? "") ? sp.get("status")! : "open";
  const contactId = sp.get("contactId");
  const assignee = sp.get("assignee");
  const parsed = parseInt(sp.get("limit") ?? "50", 10);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;

  const supabase = (await createServerClient()) as any;

  let query = supabase
    .from("network_tasks")
    .select(
      "id, title, notes, due_at, priority, status, assignee_id, contact_id, completed_at, created_at, network_contacts(full_name)",
    )
    .eq("organization_id", auth.ctx.orgId)
    .eq("status", status);

  if (contactId) query = query.eq("contact_id", contactId);
  if (assignee === "me") query = query.eq("assignee_id", auth.ctx.userId);
  else if (assignee === "unassigned") query = query.is("assignee_id", null);
  else if (assignee) query = query.eq("assignee_id", assignee);

  // Open work sorts by urgency; anything closed sorts by when it closed.
  const [names, { data, error }] = await Promise.all([
    loadPrincipalNames(supabase, auth.ctx.orgId),
    status === "open"
      ? query.order("due_at", { ascending: true, nullsFirst: false }).limit(limit)
      : query.order("completed_at", { ascending: false, nullsFirst: false }).limit(limit),
  ]);

  if (error) {
    console.error("[network/tasks] read", error);
    return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 });
  }

  const now = Date.now();
  return NextResponse.json({
    tasks: (data ?? []).map((t: Record<string, any>) => {
      const joined = Array.isArray(t.network_contacts) ? t.network_contacts[0] : t.network_contacts;
      return {
        id: t.id,
        title: t.title,
        notes: t.notes ?? null,
        dueAt: t.due_at ?? null,
        priority: t.priority,
        status: t.status,
        assigneeId: t.assignee_id ?? null,
        assigneeName: t.assignee_id ? (names.get(String(t.assignee_id)) ?? null) : null,
        contactId: t.contact_id ?? null,
        contactName: joined?.full_name ?? null,
        completedAt: t.completed_at ?? null,
        createdAt: t.created_at,
        overdue: t.status === "open" && t.due_at ? Date.parse(t.due_at) < now : false,
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:network-task-create`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 60) },
    );
  }

  const payload = (await req.json().catch(() => null)) as {
    contactId?: string;
    title?: string;
    notes?: string;
    dueAt?: string | null;
    priority?: string;
    assigneeId?: string | null;
  } | null;

  const title = payload?.title?.trim();
  if (!payload?.contactId || !title) {
    return NextResponse.json({ error: "contactId and title are required." }, { status: 400 });
  }

  let dueAt: string | null = null;
  if (payload.dueAt) {
    const ms = Date.parse(payload.dueAt);
    if (Number.isNaN(ms)) {
      return NextResponse.json({ error: "dueAt must be a valid date." }, { status: 400 });
    }
    dueAt = new Date(ms).toISOString();
  }

  const supabase = (await createServerClient()) as any;

  const { data: contact } = await supabase
    .from("network_contacts")
    .select("id, full_name")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", payload.contactId)
    .maybeSingle();
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  // An unassigned follow-up is one nobody does, so it defaults to its creator.
  const assigneeId = payload.assigneeId === null ? null : (payload.assigneeId ?? auth.ctx.userId);

  const { data, error } = await supabase
    .from("network_tasks")
    .insert({
      organization_id: auth.ctx.orgId,
      contact_id: payload.contactId,
      title: title.slice(0, 300),
      notes: payload.notes?.slice(0, 5_000) || null,
      due_at: dueAt,
      priority: PRIORITIES.includes(payload.priority ?? "") ? payload.priority : "normal",
      assignee_id: assigneeId,
      created_by: auth.ctx.userId,
    })
    .select("id, title, notes, due_at, priority, status, assignee_id, contact_id, completed_at, created_at")
    .single();

  if (error || !data) {
    console.error("[network/tasks] insert", error);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }

  await recordNetworkAudit(supabase, {
    orgId: auth.ctx.orgId,
    actorId: auth.ctx.userId,
    action: "create",
    entityType: "network_task",
    entityId: String(data.id),
    entityLabel: contact.full_name ?? null,
    metadata: { contactId: payload.contactId, dueAt },
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
      assigneeName: null,
      contactId: data.contact_id ?? null,
      completedAt: null,
      createdAt: data.created_at,
      overdue: false,
    },
  });
}
