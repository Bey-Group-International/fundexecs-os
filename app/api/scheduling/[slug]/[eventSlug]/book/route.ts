// Claim a slot on a public booking page. Fully anonymous — the invitee has no
// account — so this runs service-role, rate-limits by IP, and re-derives the
// host's open slots before writing. The slot list the page rendered is only a
// suggestion; this route decides.
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { SITE_URL } from "@/lib/site";
import { buildMeetingInviteUrl } from "@/lib/meetings/service";
import { buildBookingManageUrl, validateBookingRequest } from "@/lib/meetings/scheduling";
import {
  SlotUnavailableError,
  createBooking,
  resolvePublicPage,
  serializeBooking,
} from "@/lib/meetings/scheduling-service";
import { sendBookingEmails } from "@/lib/meetings/scheduling-email";
import { hostContactFor } from "@/lib/meetings/scheduling-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Booking is an unauthenticated write that sends email, so it's capped per IP.
const BOOKING_LIMIT = 10;
const BOOKING_WINDOW_MS = 10 * 60_000;

interface BookBody {
  startIso?: string;
  name?: string;
  email?: string;
  notes?: string;
  timezone?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; eventSlug: string }> },
) {
  try {
    if (!hasSupabaseServiceEnv()) {
      return NextResponse.json({ error: "Scheduling is not configured on this deployment." }, { status: 503 });
    }

    const limit = checkRateLimit({
      key: `booking:${clientIp(req)}`,
      limit: BOOKING_LIMIT,
      windowMs: BOOKING_WINDOW_MS,
    });
    if (!limit.ok) return rateLimitResponse(limit, BOOKING_LIMIT) as NextResponse;

    const { slug, eventSlug } = await params;
    const body = (await req.json().catch(() => ({}))) as BookBody;

    const fieldErrors = validateBookingRequest({
      name: body.name,
      email: body.email,
      startIso: body.startIso,
    });
    if (Object.keys(fieldErrors).length > 0) {
      return NextResponse.json({ error: "Check the highlighted fields.", fieldErrors }, { status: 422 });
    }

    const service = createServiceClient();
    const resolved = await resolvePublicPage(service, slug);
    if (!resolved) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const eventType = resolved.eventTypes.find((t) => t.slug === eventSlug);
    if (!eventType) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { booking, roomCode } = await createBooking(service, {
      page: resolved.page,
      eventType,
      startIso: body.startIso!,
      inviteeName: body.name!.trim(),
      inviteeEmail: body.email!.trim(),
      inviteeNotes: body.notes ?? null,
      inviteeTimezone: body.timezone ?? null,
    });

    const host = await hostContactFor(service, resolved.page);
    const joinUrl = roomCode ? buildMeetingInviteUrl(SITE_URL, roomCode) : null;
    const manageUrl = buildBookingManageUrl(SITE_URL, booking.manage_token);

    await sendBookingEmails(booking.status === "pending" ? "requested" : "confirmed", {
      // The invitee is anonymous, so the sending mailbox comes from the
      // scheduling page's organization — the host's own, which is whose name
      // is on the email anyway.
      orgId: resolved.page.organization_id ?? undefined,
      eventTitle: eventType.title,
      hostName: resolved.page.display_name,
      hostEmail: host.email,
      inviteeName: booking.invitee_name,
      inviteeEmail: booking.invitee_email,
      inviteeTimezone: booking.invitee_timezone,
      hostTimezone: resolved.page.timezone,
      startIso: booking.starts_at,
      endIso: booking.ends_at,
      durationMinutes: eventType.duration_minutes,
      notes: booking.invitee_notes,
      joinUrl,
      manageUrl,
      hostMeetingsUrl: `${SITE_URL}/meetings`,
      bookingId: booking.id,
      bookingCreatedAt: booking.created_at,
      bookingUpdatedAt: booking.updated_at,
      bookingSequence: booking.calendar_sequence,
      siteUrl: SITE_URL,
    });

    return NextResponse.json({
      booking: serializeBooking({ ...booking, event_title: eventType.title }),
      status: booking.status,
      joinUrl,
      manageUrl,
      manageToken: booking.manage_token,
    });
  } catch (err) {
    if (err instanceof SlotUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[/api/scheduling/[slug]/[eventSlug]/book] POST", err);
    return NextResponse.json({ error: "Failed to book this time" }, { status: 500 });
  }
}
