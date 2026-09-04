// The invitee's cancel / reschedule endpoint. The manage token in the path is
// the whole credential — 160 bits of CSPRNG, mailed only to the person who
// booked — so it is treated exactly like the room code on a meeting link:
// enough to act on this one booking, and useless for anything else.
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { hostCredentials } from "@/lib/meetings/mailbox.server";
import { checkRateLimit, clientIp, rateLimitResponse } from "@/lib/rate-limit";
import { SITE_URL } from "@/lib/site";
import { buildMeetingInviteUrl } from "@/lib/meetings/service";
import { buildBookingManageUrl, buildBookingPageUrl } from "@/lib/meetings/scheduling";
import {
  SlotUnavailableError,
  cancelBooking,
  loadBookingByToken,
  openSlots,
  rescheduleBooking,
  serializeBooking,
  serializeEventType,
  serializePublicPage,
} from "@/lib/meetings/scheduling-service";
import { sendBookingEmails } from "@/lib/meetings/scheduling-email";
import { hostContactFor } from "@/lib/meetings/scheduling-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANAGE_LIMIT = 20;
const MANAGE_WINDOW_MS = 10 * 60_000;

/** The booking behind a manage link, plus the slots it could move to. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    if (!hasSupabaseServiceEnv()) {
      return NextResponse.json({ error: "Scheduling is not configured on this deployment." }, { status: 503 });
    }
    const { token } = await params;
    const service = createServiceClient();
    const ctx = await loadBookingByToken(service, token);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const changeable = ctx.booking.status === "confirmed" || ctx.booking.status === "pending";
    // Only fetch alternatives when there's something to move.
    const slots = changeable
      ? (await openSlots(service, ctx.page, ctx.eventType, { excludeBookingId: ctx.booking.id })).slots
      : [];

    const { meetingType: _meetingType, isActive: _isActive, sortOrder: _sortOrder, ...publicEventType } =
      serializeEventType(ctx.eventType);

    return NextResponse.json({
      booking: serializeBooking({ ...ctx.booking, event_title: ctx.eventType.title }),
      page: serializePublicPage(ctx.page),
      eventType: publicEventType,
      hostTimezone: ctx.page.timezone,
      joinUrl: ctx.roomCode ? buildMeetingInviteUrl(SITE_URL, ctx.roomCode) : null,
      bookingPageUrl: buildBookingPageUrl(SITE_URL, ctx.page.slug),
      slots,
    });
  } catch (err) {
    console.error("[/api/scheduling/booking/[token]] GET", err);
    return NextResponse.json({ error: "Failed to load booking" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    if (!hasSupabaseServiceEnv()) {
      return NextResponse.json({ error: "Scheduling is not configured on this deployment." }, { status: 503 });
    }

    const limit = checkRateLimit({
      key: `booking-manage:${clientIp(req)}`,
      limit: MANAGE_LIMIT,
      windowMs: MANAGE_WINDOW_MS,
    });
    if (!limit.ok) return rateLimitResponse(limit, MANAGE_LIMIT) as NextResponse;

    const { token } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      action?: "cancel" | "reschedule";
      startIso?: string;
      reason?: string;
    };
    if (body.action !== "cancel" && body.action !== "reschedule") {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    const service = createServiceClient();
    const ctx = await loadBookingByToken(service, token);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (ctx.booking.status === "cancelled" || ctx.booking.status === "declined") {
      return NextResponse.json({ error: "This booking is already closed." }, { status: 409 });
    }
    // A meeting that has already happened can't be moved or called off.
    if (new Date(ctx.booking.ends_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "This meeting has already passed." }, { status: 409 });
    }

    const host = await hostContactFor(service, ctx.page);
    let next = ctx;

    if (body.action === "cancel") {
      next = await cancelBooking(service, ctx, "invitee", body.reason);
    } else {
      if (!body.startIso) return NextResponse.json({ error: "Pick a new time." }, { status: 422 });
      next = await rescheduleBooking(service, ctx, body.startIso);
    }

    await sendBookingEmails(body.action === "cancel" ? "cancelled_by_invitee" : "rescheduled", {
      // The invitee holds only a manage token, so there is no acting user.
      // The host is who this is from.
      credentials: await hostCredentials(service, next.booking.host_user_id, next.booking.organization_id ?? undefined),
      // Anonymous invitee: the host org's mailbox sends, as on the public
      // booking route.
      orgId: next.page.organization_id ?? undefined,
      eventTitle: next.eventType.title,
      hostName: next.page.display_name,
      hostEmail: host.email,
      inviteeName: next.booking.invitee_name,
      inviteeEmail: next.booking.invitee_email,
      inviteeTimezone: next.booking.invitee_timezone,
      hostTimezone: next.page.timezone,
      startIso: next.booking.starts_at,
      endIso: next.booking.ends_at,
      durationMinutes: next.eventType.duration_minutes,
      notes: next.booking.invitee_notes,
      joinUrl: next.roomCode ? buildMeetingInviteUrl(SITE_URL, next.roomCode) : null,
      manageUrl: buildBookingManageUrl(SITE_URL, next.booking.manage_token),
      manageToken: next.booking.manage_token,
      reason: body.reason ?? null,
      bookingId: next.booking.id,
      bookingCreatedAt: next.booking.created_at,
      bookingUpdatedAt: next.booking.updated_at,
      bookingSequence: next.booking.calendar_sequence,
      siteUrl: SITE_URL,
    });

    return NextResponse.json({
      booking: serializeBooking({ ...next.booking, event_title: next.eventType.title }),
      joinUrl: next.roomCode ? buildMeetingInviteUrl(SITE_URL, next.roomCode) : null,
    });
  } catch (err) {
    if (err instanceof SlotUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[/api/scheduling/booking/[token]] POST", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update booking" },
      { status: 500 },
    );
  }
}
