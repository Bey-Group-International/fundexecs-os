// One booking as a downloadable calendar entry, for the "Save to calendar"
// button in the booking emails.
//
// The manage token in the path is the whole credential, exactly as it is for
// the cancel/reschedule endpoint beside this — 160 bits of CSPRNG, mailed only
// to the person who booked. So this is anonymous by design, and returns only
// what their confirmation email already told them: what, when, and where to
// join. The host's address, the invitee list and the booking's notes stay out
// of it, which is also why this publishes rather than invites — an iTIP
// REQUEST would have to name an ORGANIZER and an ATTENDEE.
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { buildIcs } from "@/lib/calendar/ics";
import { inviteUid } from "@/lib/calendar/invite";
import { buildMeetingInviteUrl } from "@/lib/meetings/service";
import { loadBookingByToken } from "@/lib/meetings/scheduling-service";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A refusal that tells a guesser nothing about which tokens are real. */
function notFound() {
  return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    if (!hasSupabaseServiceEnv()) return notFound();

    const { token } = await params;
    if (!token?.trim()) return notFound();

    const ctx = await loadBookingByToken(createServiceClient(), token.trim());
    if (!ctx) return notFound();

    // Only a confirmed booking is a commitment. A pending request is a hold the
    // host may yet decline, and putting that in somebody's calendar is the very
    // thing the emails avoid by withholding the .ics until it is confirmed; a
    // cancelled one has nothing left to save.
    if (ctx.booking.status !== "confirmed") return notFound();

    const joinUrl = ctx.roomCode ? buildMeetingInviteUrl(SITE_URL, ctx.roomCode) : null;
    const title = `${ctx.eventType.title} with ${ctx.page.display_name}`;

    const body = buildIcs(
      [
        {
          // The UID the confirmation's .ics already carries, so saving from the
          // button corrects that entry instead of adding a second one beside it.
          uid: inviteUid(ctx.booking.id, SITE_URL),
          startIso: ctx.booking.starts_at,
          endIso: ctx.booking.ends_at,
          summary: title,
          description: joinUrl ? `Join: ${joinUrl}` : null,
          location: joinUrl,
          url: joinUrl,
          sequence: Math.max(0, Math.floor(ctx.booking.calendar_sequence ?? 0)),
        },
      ],
      { calendarName: title },
    );

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="meeting.ics"',
        // The URL is a capability, so no shared cache may hold the response.
        "Cache-Control": "private, no-store, max-age=0",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (err) {
    console.error("[/api/scheduling/booking/[token]/calendar.ics] GET", err);
    // Even an internal failure answers 404, so no token behaves observably
    // differently from any other.
    return notFound();
  }
}
