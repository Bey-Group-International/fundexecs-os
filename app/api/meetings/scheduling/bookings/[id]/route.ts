// Host decisions on a booking made through their scheduling link: approve a
// pending request, decline it, cancel one that was already confirmed, or move
// either to another time.
//
// The host is never held to the rules their link publishes for invitees —
// working hours, notice, buffer, booking window. A clash with their own
// calendar is a warning (409 with `overridable: true`) that `allowConflict`
// clears. Only another live booking on the same time is a hard stop.
//
// Bookings are written by anonymous invitees, so the table grants clients no
// write policy at all — every mutation runs service-role behind an explicit
// ownership check against the signed-in host.
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { hostCredentials } from "@/lib/meetings/mailbox.server";
import { requireOrgContext } from "@/lib/auth";
import { SITE_URL } from "@/lib/site";
import { buildMeetingInviteUrl } from "@/lib/meetings/service";
import { buildBookingManageUrl, buildBookingPageUrl, normalizeBookingReason } from "@/lib/meetings/scheduling";
import {
  HOST_BOOKING_OVERLAP_MESSAGE,
  SlotUnavailableError,
  approveBooking,
  cancelBooking,
  declineBooking,
  hostConflictMessage,
  hostConflicts,
  loadBookingById,
  rescheduleBooking,
  serializeBooking,
} from "@/lib/meetings/scheduling-service";
import { sendBookingEmails } from "@/lib/meetings/scheduling-email";

export const runtime = "nodejs";

type Action = "approve" | "decline" | "cancel" | "reschedule";
const ACTIONS: readonly Action[] = ["approve", "decline", "cancel", "reschedule"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireOrgContext();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    if (!hasSupabaseServiceEnv()) {
      return NextResponse.json({ error: "Scheduling links are not configured on this deployment." }, { status: 503 });
    }

    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      action?: Action;
      reason?: unknown;
      startIso?: unknown;
      allowConflict?: unknown;
    };
    const action = body.action;
    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
    const allowConflict = body.allowConflict === true;
    const newStart = typeof body.startIso === "string" ? new Date(body.startIso) : null;
    if (action === "reschedule" && (!newStart || isNaN(newStart.getTime()))) {
      return NextResponse.json({ error: "Pick a new time." }, { status: 422 });
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

    const reason = normalizeBookingReason(body.reason);
    let next = ctx;
    let emailKind: Parameters<typeof sendBookingEmails>[0];

    const previousStartIso = ctx.booking.starts_at;

    if (action === "approve") {
      next = await approveBooking(service, ctx, { allowConflict });
      emailKind = "confirmed";
    } else if (action === "reschedule") {
      const startIso = newStart!.toISOString();
      if (startIso === ctx.booking.starts_at) {
        return NextResponse.json({ error: "That's the time it's already at." }, { status: 422 });
      }
      const endIso = new Date(newStart!.getTime() + ctx.eventType.duration_minutes * 60_000).toISOString();
      if (!allowConflict) {
        const clashes = await hostConflicts(service, ctx.page, startIso, endIso, {
          excludeBookingId: ctx.booking.id,
          excludeMeetingId: ctx.booking.meeting_id,
        });
        if (clashes.length > 0) {
          return NextResponse.json(
            { error: hostConflictMessage("move"), overridable: true, busy: clashes },
            { status: 409 },
          );
        }
      }
      try {
        next = await rescheduleBooking(service, ctx, startIso, { enforceAvailability: false });
      } catch (err) {
        if (err instanceof SlotUnavailableError) throw new SlotUnavailableError(HOST_BOOKING_OVERLAP_MESSAGE);
        throw err;
      }
      // A confirmed booking is a meeting that moved. A pending request is not
      // a meeting yet: the invitee hears that a different time is on offer,
      // with no calendar invite for something the host has not accepted.
      emailKind = next.booking.status === "confirmed" ? "rescheduled_by_host" : "request_moved_by_host";
    } else if (action === "decline") {
      next = await declineBooking(service, ctx, reason);
      emailKind = "declined";
    } else {
      next = await cancelBooking(service, ctx, "host", reason);
      emailKind = "cancelled_by_host";
    }

    // Only a confirmed booking is a calendar entry worth saving or updating.
    const holdsCalendarEntry =
      action === "approve" || (action === "reschedule" && next.booking.status === "confirmed");

    // Notifying is best-effort: the decision is already recorded, and a failed
    // send must not leave the host unsure whether it went through.
    await sendBookingEmails(emailKind, {
      // The host is the acting user here — the route already refuses anyone
      // else — so this is their own mailbox.
      credentials: await hostCredentials(service, auth.ctx.userId, auth.ctx.orgId),
      orgId: auth.ctx.orgId,
      eventTitle: next.eventType.title,
      hostName: next.page.display_name,
      hostEmail: auth.ctx.email,
      inviteeName: next.booking.invitee_name,
      inviteeEmail: next.booking.invitee_email,
      guestEmails: next.booking.invitee_guests ?? [],
      inviteeTimezone: next.booking.invitee_timezone,
      hostTimezone: next.page.timezone,
      startIso: next.booking.starts_at,
      endIso: next.booking.ends_at,
      ...(action === "reschedule" ? { previousStartIso } : {}),
      durationMinutes: next.eventType.duration_minutes,
      notes: next.booking.invitee_notes,
      joinUrl: next.roomCode ? buildMeetingInviteUrl(SITE_URL, next.roomCode) : null,
      // A declined or cancelled invitee gets the booking page back, not a
      // manage link for a booking that no longer exists.
      manageUrl:
        action === "approve" || action === "reschedule"
          ? buildBookingManageUrl(SITE_URL, next.booking.manage_token)
          : buildBookingPageUrl(SITE_URL, next.page.slug, undefined, {
              name: next.booking.invitee_name,
              email: next.booking.invitee_email,
            }),
      // Same reasoning: only an approval leaves a booking worth saving, and the
      // endpoint refuses anything that is not confirmed regardless.
      manageToken: holdsCalendarEntry ? next.booking.manage_token : null,
      reason,
      bookingId: next.booking.id,
      bookingCreatedAt: next.booking.created_at,
      bookingUpdatedAt: next.booking.updated_at,
      bookingSequence: next.booking.calendar_sequence,
      siteUrl: SITE_URL,
    });

    return NextResponse.json({
      booking: serializeBooking({ ...next.booking, event_title: next.eventType.title }),
      roomCode: next.roomCode,
    });
  } catch (err) {
    if (err instanceof SlotUnavailableError) {
      return NextResponse.json({ error: err.message, overridable: err.overridable }, { status: 409 });
    }
    console.error("[/api/meetings/scheduling/bookings/[id]] PATCH", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update booking" },
      { status: 500 },
    );
  }
}
