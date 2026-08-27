// Host decisions on a booking made through their scheduling link: approve a
// pending request, decline it, or cancel one that was already confirmed.
//
// Bookings are written by anonymous invitees, so the table grants clients no
// write policy at all — every mutation runs service-role behind an explicit
// ownership check against the signed-in host.
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { SITE_URL } from "@/lib/site";
import { buildMeetingInviteUrl } from "@/lib/meetings/service";
import { buildBookingManageUrl, buildBookingPageUrl } from "@/lib/meetings/scheduling";
import {
  SlotUnavailableError,
  approveBooking,
  cancelBooking,
  declineBooking,
  loadBookingById,
  serializeBooking,
} from "@/lib/meetings/scheduling-service";
import { sendBookingEmails } from "@/lib/meetings/scheduling-email";

export const runtime = "nodejs";

type Action = "approve" | "decline" | "cancel";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    if (!hasSupabaseServiceEnv()) {
      return NextResponse.json({ error: "Scheduling links are not configured on this deployment." }, { status: 503 });
    }

    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { action?: Action; reason?: string };
    const action = body.action;
    if (action !== "approve" && action !== "decline" && action !== "cancel") {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    const service = createServiceClient();
    const ctx = await loadBookingById(service, id);
    if (!ctx) return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    // Service-role reads bypass RLS, so ownership is checked here explicitly.
    if (ctx.booking.host_user_id !== auth.ctx.userId) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    // A booking that is already declined or cancelled has nothing left to act
    // on. Without this, a second tab (or a double click) would fall through to
    // the no-op cancel below and still email the invitee "your meeting was
    // cancelled" about a booking that was actually declined.
    if (ctx.booking.status === "declined" || ctx.booking.status === "cancelled") {
      return NextResponse.json(
        {
          error: `This booking was already ${ctx.booking.status}.`,
          booking: serializeBooking({ ...ctx.booking, event_title: ctx.eventType.title }),
        },
        { status: 409 },
      );
    }

    let next = ctx;
    let emailKind: Parameters<typeof sendBookingEmails>[0];

    if (action === "approve") {
      next = await approveBooking(service, ctx);
      emailKind = "confirmed";
    } else if (action === "decline") {
      next = await declineBooking(service, ctx, body.reason);
      emailKind = "declined";
    } else {
      next = await cancelBooking(service, ctx, "host", body.reason);
      emailKind = "cancelled_by_host";
    }

    // Notifying is best-effort: the decision is already recorded, and a failed
    // send must not leave the host unsure whether it went through.
    await sendBookingEmails(emailKind, {
      orgId: auth.ctx.orgId,
      eventTitle: next.eventType.title,
      hostName: next.page.display_name,
      hostEmail: auth.ctx.email,
      inviteeName: next.booking.invitee_name,
      inviteeEmail: next.booking.invitee_email,
      inviteeTimezone: next.booking.invitee_timezone,
      hostTimezone: next.page.timezone,
      startIso: next.booking.starts_at,
      endIso: next.booking.ends_at,
      durationMinutes: next.eventType.duration_minutes,
      notes: next.booking.invitee_notes,
      joinUrl: next.roomCode ? buildMeetingInviteUrl(SITE_URL, next.roomCode) : null,
      // A declined or cancelled invitee gets the booking page back, not a
      // manage link for a booking that no longer exists.
      manageUrl:
        action === "approve"
          ? buildBookingManageUrl(SITE_URL, next.booking.manage_token)
          : buildBookingPageUrl(SITE_URL, next.page.slug),
      reason: body.reason ?? null,
      bookingId: next.booking.id,
      bookingCreatedAt: next.booking.created_at,
      bookingUpdatedAt: next.booking.updated_at,
      siteUrl: SITE_URL,
    });

    return NextResponse.json({
      booking: serializeBooking({ ...next.booking, event_title: next.eventType.title }),
      roomCode: next.roomCode,
    });
  } catch (err) {
    if (err instanceof SlotUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("[/api/meetings/scheduling/bookings/[id]] PATCH", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update booking" },
      { status: 500 },
    );
  }
}
