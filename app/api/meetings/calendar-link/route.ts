import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { buildMeetingInviteUrl, buildMeetingRoomUrl, createMeeting } from "@/lib/meetings/service";
import { SITE_URL } from "@/lib/site";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/** Format a Date as a Google Calendar datetime string: YYYYMMDDTHHmmssZ */
function toGCalDate(d: Date): string {
  return (
    d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    "T" +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    "00Z"
  );
}

export async function GET(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = req.nextUrl;

  const title = searchParams.get("title") || "Meeting";
  const roomCode = searchParams.get("roomCode") || "";
  const startIso = searchParams.get("startIso") || new Date().toISOString();
  const durationMinutes = parseInt(searchParams.get("durationMinutes") || "60", 10);
  const timezone = searchParams.get("timezone") || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const meetingType = searchParams.get("meetingType") || "internal_strategy";

  const start = new Date(startIso);
  if (isNaN(start.getTime())) {
    return NextResponse.json({ error: "Invalid startIso" }, { status: 400 });
  }

  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

  // Canonical app URL so the emailed / calendar join links resolve for
  // recipients regardless of the proxy/preview host that served this request.
  const origin = SITE_URL;
  const supabase = await createServerClient();
  const meeting = await createMeeting(supabase, {
    title,
    orgId: auth.ctx.orgId,
    hostId: auth.ctx.userId,
    roomCode: roomCode || null,
    scheduledAt: start.toISOString(),
    durationMinutes,
    timezone,
    meetingType,
  });

  const joinUrl = buildMeetingInviteUrl(origin, meeting.roomCode);
  const roomUrl = buildMeetingRoomUrl(origin, meeting.roomCode);

  const details = `Join meeting: ${joinUrl}`;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${toGCalDate(start)}/${toGCalDate(end)}`,
    details,
  });

  const googleCalendarUrl = `https://calendar.google.com/calendar/render?${params.toString()}`;

  return NextResponse.json({
    id: meeting.id,
    roomCode: meeting.roomCode,
    scheduledAt: meeting.scheduledAt,
    durationMinutes: meeting.durationMinutes,
    url: roomUrl,
    inviteUrl: joinUrl,
    googleCalendarUrl,
  });
}
