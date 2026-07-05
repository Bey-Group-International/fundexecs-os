import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { buildMeetingInviteUrl, buildMeetingRoomUrl, createMeeting } from "@/lib/meetings/service";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const supabase = await createServerClient();
    const body = await req.json() as {
      title?: string;
      orgId?: string;
      dealId?: string;
      roomCode?: string;
      scheduledAt?: string;
      durationMinutes?: number;
      timezone?: string;
      meetingType?: string;
    };

    if (body.orgId && body.orgId !== auth.ctx.orgId) {
      return NextResponse.json({ error: "Not a member of that organization" }, { status: 403 });
    }

    const meeting = await createMeeting(supabase, {
      title: body.title,
      orgId: auth.ctx.orgId,
      hostId: auth.ctx.userId,
      dealId: body.dealId ?? null,
      roomCode: body.roomCode ?? null,
      scheduledAt: body.scheduledAt ?? null,
      durationMinutes: body.durationMinutes ?? null,
      timezone: body.timezone ?? null,
      meetingType: body.meetingType ?? null,
    });

    return NextResponse.json({
      id: meeting.id,
      roomCode: meeting.roomCode,
      hostId: meeting.hostId,
      scheduledAt: meeting.scheduledAt,
      durationMinutes: meeting.durationMinutes,
      inviteUrl: buildMeetingInviteUrl(req.nextUrl.origin, meeting.roomCode),
      roomUrl: buildMeetingRoomUrl(req.nextUrl.origin, meeting.roomCode),
    });
  } catch (err) {
    console.error("[/api/meetings/create]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create meeting" },
      { status: 500 },
    );
  }
}
