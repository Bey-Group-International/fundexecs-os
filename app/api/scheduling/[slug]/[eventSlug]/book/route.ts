// Claim a slot on a public booking page. Fully anonymous — the invitee has no
// account — so this runs service-role, rate-limits by IP, and re-derives the
// host's open slots before writing. The slot list the page rendered is only a
// suggestion; this route decides.
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { SITE_URL } from "@/lib/site";
import { buildMeetingInviteUrl } from "@/lib/meetings/service";
import {
  buildBookingCalendarUrl,
  buildBookingManageUrl,
  isValidTimezone,
  parseBookingGuests,
  validateBookingRequest,
} from "@/lib/meetings/scheduling";
import {
  SlotUnavailableError,
  createBooking,
  openSlots,
  resolvePublicPage,
  serializeBooking,
  type SchedulingClient,
} from "@/lib/meetings/scheduling-service";
import type { SchedulingEventType, SchedulingPage } from "@/lib/supabase/database.types";
import { sendBookingConfirmation } from "@/lib/meetings/booking-confirmation.server";

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
  /** Extra guests: a list of emails, or one comma-separated string. */
  guests?: unknown;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; eventSlug: string }> },
) {
  // Kept outside the try so a lost slot can be answered with the times still open.
  let bookingTarget: { client: SchedulingClient; page: SchedulingPage; eventType: SchedulingEventType } | null = null;
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
      notes: body.notes,
      startIso: body.startIso,
    });
    const guestList = parseBookingGuests(body.guests, body.email ?? "");
    if ("error" in guestList) fieldErrors.guests = guestList.error;
    if (Object.keys(fieldErrors).length > 0) {
      return NextResponse.json({ error: "Check the highlighted fields.", fieldErrors }, { status: 422 });
    }

    const service = createServiceClient();
    const resolved = await resolvePublicPage(service, slug);
    if (!resolved) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const eventType = resolved.eventTypes.find((t) => t.slug === eventSlug);
    if (!eventType) return NextResponse.json({ error: "Not found" }, { status: 404 });
    bookingTarget = { client: service, page: resolved.page, eventType };

    const { booking, roomCode } = await createBooking(service, {
      page: resolved.page,
      eventType,
      startIso: body.startIso!,
      inviteeName: body.name!.trim(),
      inviteeEmail: body.email!.trim(),
      inviteeGuests: "guests" in guestList ? guestList.guests : [],
      inviteeNotes: body.notes ?? null,
      // Anything but a real zone falls back to the host's, rather than being
      // stored and read back into every later email about this booking.
      inviteeTimezone: isValidTimezone(body.timezone) ? body.timezone : null,
    });

    const joinUrl = roomCode ? buildMeetingInviteUrl(SITE_URL, roomCode) : null;
    const manageUrl = buildBookingManageUrl(SITE_URL, booking.manage_token);

    // Marks the booking for the cron to retry if the invitee's copy fails.
    const mail = await sendBookingConfirmation(service, { booking, page: resolved.page, eventType, roomCode });

    return NextResponse.json({
      booking: serializeBooking({ ...booking, event_title: eventType.title }),
      status: booking.status,
      joinUrl,
      manageUrl,
      manageToken: booking.manage_token,
      // Whether the invitee's confirmation actually went out. When it didn't —
      // no host mailbox, or the mail provider down — this page is the only
      // record they get, so it must not say otherwise.
      emailed: mail.inviteeSent,
      // A calendar file that doesn't depend on email arriving. Confirmed only:
      // a pending request is a hold the host may still decline.
      calendarUrl: booking.status === "confirmed" ? buildBookingCalendarUrl(SITE_URL, booking.manage_token) : null,
    });
  } catch (err) {
    if (err instanceof SlotUnavailableError) {
      // The times still open, so the page can redraw and offer the nearest one
      // without a second request. Best effort: without them the page refetches.
      let slots: Awaited<ReturnType<typeof openSlots>>["slots"] | undefined;
      if (bookingTarget) {
        try {
          slots = (await openSlots(bookingTarget.client, bookingTarget.page, bookingTarget.eventType)).slots;
        } catch (slotErr) {
          console.error("[/api/scheduling/[slug]/[eventSlug]/book] fresh slots after 409", slotErr);
        }
      }
      return NextResponse.json({ error: err.message, ...(slots ? { slots } : {}) }, { status: 409 });
    }
    console.error("[/api/scheduling/[slug]/[eventSlug]/book] POST", err);
    return NextResponse.json({ error: "Failed to book this time" }, { status: 500 });
  }
}
