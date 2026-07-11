import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { sendMeetingInvites } from "@/lib/meetings/invite";
import { SITE_URL } from "@/lib/site";

export async function POST(req: NextRequest) {
  // Require an org context — sending FundExecs-branded invite emails must be
  // tied to a meeting the caller's org actually owns. Without this, any signed-in
  // user could POST an arbitrary roomCode + arbitrary recipient list + attacker-
  // controlled title and turn this endpoint into an open branded-email relay.
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json().catch(() => ({}))) as { roomCode?: string; emails?: string[]; meetingTitle?: string };
  if (!body.roomCode || !Array.isArray(body.emails) || body.emails.length === 0) {
    return NextResponse.json({ error: "roomCode and emails required" }, { status: 400 });
  }

  // Verify the room belongs to the caller's org before sending. The org-scoped
  // query (RLS + explicit organization_id filter) returns nothing for a room the
  // caller isn't entitled to, which we treat as not-found.
  const supabase = await createServerClient();
  const { data: meeting } = await supabase
    .from("live_meetings")
    .select("id, title")
    .eq("room_code", body.roomCode)
    .eq("organization_id", auth.ctx.orgId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

  const { sent, total } = await sendMeetingInvites({
    // Canonical app URL so the emailed link is stable across hosts/proxies.
    origin: SITE_URL,
    roomCode: body.roomCode,
    // Prefer the stored title over the caller-supplied one so the email can't be
    // used to render arbitrary text under the FundExecs brand.
    title: (meeting.title as string | null) ?? body.meetingTitle ?? "Meeting",
    senderName: auth.ctx.email ?? "Someone",
    emails: body.emails,
  });

  return NextResponse.json({ ok: true, sent, total });
}
