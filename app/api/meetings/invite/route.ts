import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { sendMeetingInvites } from "@/lib/meetings/invite";
import { SITE_URL } from "@/lib/site";

export async function POST(req: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as { roomCode?: string; emails?: string[]; meetingTitle?: string };
  if (!body.roomCode || !Array.isArray(body.emails) || body.emails.length === 0) {
    return NextResponse.json({ error: "roomCode and emails required" }, { status: 400 });
  }

  const { sent, total } = await sendMeetingInvites({
    // Canonical app URL so the emailed link is stable across hosts/proxies.
    origin: SITE_URL,
    roomCode: body.roomCode,
    title: body.meetingTitle ?? "Meeting",
    senderName: user.email ?? "Someone",
    emails: body.emails,
  });

  return NextResponse.json({ ok: true, sent, total });
}
