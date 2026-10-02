// Linking a conversation or a meeting to a contact by hand.
//
//   POST   { threadId } | { meetingId }  — put it on the contact's timeline.
//   DELETE ?threadId= | ?meetingId=      — take a hand-made link off again.
//
// The writers link automatically, on EXACT addresses only (lib/inbox/crm-
// activity, lib/meetings/crm-activity). That is deliberately strict, so a
// conversation from somebody's second address, or a meeting they joined as a
// guest, never reaches their record on its own. This is how a person closes
// that gap — and the link they make is the same timeline row the writers make,
// keyed by the same generated thread_id / meeting_id columns, so the contact's
// communications report (lib/crm/contact-report.server.ts) picks it up with no
// second mechanism.
//
// A hand-made link is an ordinary hand-written entry: is_system false, the
// linker as its actor. So it reads as a person's claim rather than the app's
// observation, and its author can delete it under the existing policy. A link
// the APP made is not removed here; it is corrected through
// /api/network/activities/[id]/correction, which keeps it as evidence.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { recordNetworkAudit } from "@/lib/network-audit";
import { invalidateRoster } from "@/lib/network-roster";
import { activityTypeForChannel } from "@/lib/inbox/crm-activity";
import { reportUrl } from "@/lib/meetings/crm-activity";
import { boundedBody } from "@/lib/crm/contact-match";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

const UNIQUE_VIOLATION = "23505";
const LIMIT_PER_MIN = 60;
const BODY_MAX = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

function target(source: { threadId?: unknown; meetingId?: unknown }):
  | { kind: "thread"; id: string }
  | { kind: "meeting"; id: string }
  | null {
  const thread = typeof source.threadId === "string" ? source.threadId : null;
  const meeting = typeof source.meetingId === "string" ? source.meetingId : null;
  // Exactly one: "link these two things" is two requests.
  if (thread && !meeting && UUID.test(thread)) return { kind: "thread", id: thread };
  if (meeting && !thread && UUID.test(meeting)) return { kind: "meeting", id: meeting };
  return null;
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const policy = { key: `org:${auth.ctx.orgId}:contact-link`, limit: LIMIT_PER_MIN, windowMs: 60_000 };
  const rateLimit = checkRateLimit(policy);
  if (!rateLimit.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: rateLimitHeaders(rateLimit, policy.limit) },
    );
  }

  const { id: contactId } = await params;
  const link = target(((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>);
  if (!link) {
    return NextResponse.json({ error: "Send exactly one of threadId or meetingId." }, { status: 400 });
  }

  const supabase = (await createServerClient()) as any;
  const orgId = auth.ctx.orgId;

  const { data: contact } = await supabase
    .from("network_contacts")
    .select("id, full_name")
    .eq("organization_id", orgId)
    .eq("id", contactId)
    .maybeSingle();
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  // Read through the caller's client, in this org: you can only link what you
  // can see, and only within the organisation the contact belongs to.
  let row: Record<string, unknown>;
  if (link.kind === "thread") {
    const { data: thread } = await supabase
      .from("inbox_threads")
      .select("id, channel, subject, ai_summary, preview, last_message_at, created_at")
      .eq("organization_id", orgId)
      .eq("id", link.id)
      .maybeSingle();
    if (!thread) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    const text = String(thread.ai_summary ?? "").trim() || String(thread.preview ?? "").trim();
    row = {
      activity_type: activityTypeForChannel(String(thread.channel)),
      direction: "inbound",
      subject: String(thread.subject ?? "").trim() || "Conversation",
      body: text ? boundedBody(text, BODY_MAX) : null,
      occurred_at: thread.last_message_at ?? thread.created_at ?? new Date().toISOString(),
      metadata: { thread_id: thread.id, channel: thread.channel, source: "manual_link" },
    };
  } else {
    const { data: meeting } = await supabase
      .from("live_meetings")
      .select("id, room_code, title, scheduled_at, started_at, created_at")
      .eq("organization_id", orgId)
      .eq("id", link.id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    row = {
      activity_type: "meeting",
      direction: null,
      subject: String(meeting.title ?? "").trim() || "Meeting",
      body: null,
      occurred_at: meeting.started_at ?? meeting.scheduled_at ?? meeting.created_at,
      metadata: {
        meeting_id: meeting.id,
        source: "manual_link",
        report_url: reportUrl(SITE_URL, (meeting.room_code as string | null) ?? null),
      },
    };
  }

  const { data, error } = await supabase
    .from("network_activities")
    .insert({
      organization_id: orgId,
      contact_id: contactId,
      actor_id: auth.ctx.userId,
      is_system: false,
      ...row,
    })
    .select("id, activity_type, direction, subject, body, occurred_at, actor_id, is_system, metadata")
    .single();

  if (error) {
    // The unique (org, contact, thread_id|meeting_id) index: already on the record,
    // whether the app put it there or a person did.
    if (error.code === UNIQUE_VIOLATION) {
      return NextResponse.json({ error: "Already linked to this contact" }, { status: 409 });
    }
    console.error("[network/contacts/links] insert", error);
    return NextResponse.json({ error: "Failed to link" }, { status: 500 });
  }

  invalidateRoster(orgId);
  await recordNetworkAudit(supabase, {
    orgId,
    actorId: auth.ctx.userId,
    action: "create",
    entityType: "network_activity",
    entityId: String(data.id),
    entityLabel: contact.full_name ?? null,
    metadata: { contactId, link: link.kind, targetId: link.id },
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

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id: contactId } = await params;
  const link = target({
    threadId: req.nextUrl.searchParams.get("threadId") ?? undefined,
    meetingId: req.nextUrl.searchParams.get("meetingId") ?? undefined,
  });
  if (!link) {
    return NextResponse.json({ error: "Send exactly one of threadId or meetingId." }, { status: 400 });
  }

  const supabase = (await createServerClient()) as any;
  // Hand-made links only. RLS already limits a delete to your own non-system
  // entries (or any non-system entry, for an admin); filtering on is_system
  // here says so explicitly, and turns "you can't" into a 404 instead of a
  // silent zero-row success.
  const { data, error } = await supabase
    .from("network_activities")
    .delete()
    .eq("organization_id", auth.ctx.orgId)
    .eq("contact_id", contactId)
    .eq(link.kind === "thread" ? "thread_id" : "meeting_id", link.id)
    .eq("is_system", false)
    .select("id");
  if (error) {
    console.error("[network/contacts/links] delete", error);
    return NextResponse.json({ error: "Failed to unlink" }, { status: 500 });
  }
  if (!data?.length) {
    return NextResponse.json({ error: "No hand-made link to remove" }, { status: 404 });
  }
  invalidateRoster(auth.ctx.orgId);
  return NextResponse.json({ ok: true, removed: data.length });
}
