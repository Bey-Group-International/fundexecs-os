// Timeline entries for one contact.
//
//   GET  — the contact's timeline, newest first.
//   POST — log a note, call, meeting, email, or intro against them.
//
// Hand-logged entries are what make the record evidence rather than inference,
// so the write path is deliberately narrow: only the types a person can
// legitimately claim happened (LOGGABLE_TYPES), never a system type like
// stage_change that the engine writes and the audit trail depends on.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { isLoggableType, loadPrincipalNames } from "@/lib/network-contact";
import { recordNetworkAudit } from "@/lib/network-audit";
import { invalidateRoster } from "@/lib/network-roster";

export const dynamic = "force-dynamic";

const MAX_BODY = 20_000;
const MAX_SUBJECT = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const parsed = parseInt(req.nextUrl.searchParams.get("limit") ?? "100", 10);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 100;

  const supabase = (await createServerClient()) as any;
  const [names, { data, error }] = await Promise.all([
    loadPrincipalNames(supabase, auth.ctx.orgId),
    supabase
      .from("network_activities")
      .select("id, activity_type, direction, subject, body, occurred_at, actor_id, is_system, metadata")
      .eq("organization_id", auth.ctx.orgId)
      .eq("contact_id", id)
      .order("occurred_at", { ascending: false })
      .limit(limit),
  ]);

  if (error) {
    console.error("[network/activities] read", error);
    return NextResponse.json({ error: "Failed to load timeline" }, { status: 500 });
  }

  return NextResponse.json({
    entries: (data ?? []).map((a: Record<string, unknown>) => ({
      id: a.id,
      type: a.activity_type,
      direction: a.direction ?? null,
      subject: a.subject ?? null,
      body: a.body ?? null,
      occurredAt: a.occurred_at,
      actorId: a.actor_id ?? null,
      actorName: a.actor_id ? (names.get(String(a.actor_id)) ?? null) : null,
      isSystem: a.is_system === true,
      metadata: a.metadata ?? {},
    })),
  });
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rateLimit = checkRateLimit({
    key: `org:${auth.ctx.orgId}:network-log-activity`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, 60) },
    );
  }

  const { id } = await params;
  const payload = (await req.json().catch(() => null)) as {
    type?: string;
    subject?: string;
    body?: string;
    occurredAt?: string;
    direction?: string;
  } | null;

  if (!payload || !isLoggableType(payload.type)) {
    return NextResponse.json(
      { error: "A valid activity type is required (note, call, meeting, email, linkedin, intro, document, other)." },
      { status: 400 },
    );
  }

  const body = (payload.body ?? "").trim();
  const subject = (payload.subject ?? "").trim();
  if (!body && !subject) {
    return NextResponse.json({ error: "Add a subject or some detail to log." }, { status: 400 });
  }

  // A back-dated entry is legitimate; a future-dated one is not a record of
  // something that happened, so it is clamped rather than silently stored.
  let occurredAt = new Date().toISOString();
  if (payload.occurredAt) {
    const ms = Date.parse(payload.occurredAt);
    if (Number.isNaN(ms)) {
      return NextResponse.json({ error: "occurredAt must be a valid date." }, { status: 400 });
    }
    occurredAt = new Date(Math.min(ms, Date.now())).toISOString();
  }

  const direction =
    payload.direction === "inbound" || payload.direction === "outbound" || payload.direction === "internal"
      ? payload.direction
      : null;

  const supabase = (await createServerClient()) as any;

  // The contact must be visible to the caller. RLS would reject the insert
  // anyway, but reading first turns a policy violation into a clear 404.
  const { data: contact } = await supabase
    .from("network_contacts")
    .select("id, full_name")
    .eq("organization_id", auth.ctx.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("network_activities")
    .insert({
      organization_id: auth.ctx.orgId,
      contact_id: id,
      actor_id: auth.ctx.userId,
      activity_type: payload.type,
      direction,
      subject: subject.slice(0, MAX_SUBJECT) || null,
      body: body.slice(0, MAX_BODY) || null,
      occurred_at: occurredAt,
      is_system: false,
    })
    .select("id, activity_type, direction, subject, body, occurred_at, actor_id, is_system, metadata")
    .single();

  if (error || !data) {
    console.error("[network/activities] insert", error);
    return NextResponse.json({ error: "Failed to log activity" }, { status: 500 });
  }

  // The trigger just moved last_activity_at, which the roster sorts on.
  invalidateRoster(auth.ctx.orgId);

  await recordNetworkAudit(supabase, {
    orgId: auth.ctx.orgId,
    actorId: auth.ctx.userId,
    action: "create",
    entityType: "network_activity",
    entityId: String(data.id),
    entityLabel: contact.full_name ?? null,
    metadata: { contactId: id, activityType: payload.type },
  });

  return NextResponse.json({
    entry: {
      id: data.id,
      type: data.activity_type,
      direction: data.direction ?? null,
      subject: data.subject ?? null,
      body: data.body ?? null,
      occurredAt: data.occurred_at,
      actorId: data.actor_id ?? null,
      actorName: null,
      isSystem: false,
      metadata: data.metadata ?? {},
    },
  });
}
