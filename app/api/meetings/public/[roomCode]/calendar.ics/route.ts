// A single meeting as a downloadable calendar entry, for the "Save to calendar"
// button in every meeting email.
//
// Anonymous by design, like the invite screen beside it: the room code IS the
// capability, the same way a Zoom link is, so a recipient who was emailed the
// meeting can save it without an account. And like that route, this returns
// only what the invitation already told them — title, time, and where to join.
// Attendees, agenda, objective and notes stay RLS-protected and never appear
// here, which is also why this publishes rather than invites: an iTIP REQUEST
// would need an ORGANIZER address and an ATTENDEE list, and neither belongs in
// a response anybody holding the link can fetch.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { buildIcs } from "@/lib/calendar/ics";
import { meetingInviteUid } from "@/lib/calendar/invite";
import { inviteEndIso } from "@/lib/meetings/scheduled-invite";
import { buildMeetingInviteUrl } from "@/lib/meetings/service";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A refusal that tells a guesser nothing about which codes are real. */
function notFound() {
  return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ roomCode: string }> },
) {
  try {
    const { roomCode } = await params;
    const code = roomCode?.trim();
    if (!code) return notFound();

    // Service role where it exists, so an invitee with no account is served;
    // the request-scoped client otherwise, which still resolves the meeting for
    // a signed-in member. Same fallback as the public lookup beside this.
    const supabase = hasSupabaseServiceEnv() ? createServiceClient() : await createServerClient();

    const { data, error } = await supabase
      .from("live_meetings")
      .select("id, title, scheduled_at, duration_minutes, location, meeting_url, room_code, is_draft, calendar_sequence")
      .eq("room_code", code)
      .is("deleted_at", null)
      .maybeSingle();

    if (error || !data) return notFound();

    const row = data as {
      id: string;
      title: string | null;
      scheduled_at: string | null;
      duration_minutes: number | null;
      location: string | null;
      meeting_url: string | null;
      room_code: string | null;
      is_draft: boolean | null;
      calendar_sequence: number | null;
    };

    // A draft is not a commitment, and a meeting with no time cannot be an
    // entry in anybody's calendar. Both answer 404 rather than handing back an
    // empty calendar the client would silently accept.
    if (row.is_draft || !row.scheduled_at) return notFound();
    if (Number.isNaN(new Date(row.scheduled_at).getTime())) return notFound();

    const joinUrl = buildMeetingInviteUrl(SITE_URL, row.room_code ?? code);
    const place = (row.location ?? "").trim() || (row.meeting_url ?? "").trim() || joinUrl;

    const body = buildIcs(
      [
        {
          // The same UID the emailed invitation carries, so saving this
          // corrects the entry somebody already holds instead of giving them
          // the meeting twice.
          uid: meetingInviteUid(row.id, SITE_URL),
          startIso: row.scheduled_at,
          endIso: inviteEndIso(row.scheduled_at, row.duration_minutes),
          summary: row.title ?? "Meeting",
          description: place === joinUrl ? `Join: ${joinUrl}` : `${place}\n\nMeeting room: ${joinUrl}`,
          location: place,
          url: joinUrl,
          sequence: Math.max(0, Math.floor(row.calendar_sequence ?? 0)),
        },
      ],
      { calendarName: row.title ?? "Meeting" },
    );

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        // `attachment` on purpose: this is a save, and a browser that renders
        // the text inline leaves the recipient looking at raw ICS.
        "Content-Disposition": 'attachment; filename="meeting.ics"',
        // The URL is a capability, so no shared cache may hold the response.
        "Cache-Control": "private, no-store, max-age=0",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (err) {
    console.error("[/api/meetings/public/[roomCode]/calendar.ics] GET", err);
    // Even an internal failure answers 404, so no room code behaves
    // observably differently from any other.
    return notFound();
  }
}
