// lib/meetings/booking-manage.server.ts
// Reading the booking behind a manage link, once, wherever it is needed.
//
// The manage page used to be a shell: the server sent a spinner, the browser
// hydrated, and only then asked /api/scheduling/booking/[token] for the booking
// it was already holding a token for. Measured with a 25ms round trip, that one
// request is SEVEN database reads at a serial depth of four —
//
//   booking -> (page, event type) -> room code -> (meetings, bookings, blocks)
//
// — about 100ms of waiting, plus slot generation, all of it after the HTML had
// already been delivered and parsed. A stranger clicking a link in an email saw
// nothing at all for that whole time: not the meeting's name, not its time, not
// even that the link was good.
//
// So the page loads it on the server now and hands it to the client. This is
// that load, shared rather than duplicated: the route below still serves the
// same view — the client needs it after a cancel or a reschedule, and as the
// fallback when this read fails — and both go through here, so the two can never
// disagree about the shape.

import { SITE_URL } from "@/lib/site";
import { buildMeetingInviteUrl } from "@/lib/meetings/service";
import { buildBookingPageUrl } from "@/lib/meetings/scheduling";
import {
  loadBookingByToken,
  openSlots,
  serializeBooking,
  serializeEventType,
  serializePublicPage,
  type SchedulingClient,
} from "@/lib/meetings/scheduling-service";
import type { ManageBookingView } from "@/lib/meetings/booking-manage";

/**
 * The booking a manage token names, or null when it names none.
 *
 * Null is a real answer — an expired or mistyped link — and is distinct from
 * this throwing, which means the read failed and the caller should say so rather
 * than tell the invitee their link is invalid.
 */
export async function loadManageView(
  client: SchedulingClient,
  token: string,
): Promise<ManageBookingView | null> {
  const ctx = await loadBookingByToken(client, token);
  if (!ctx) return null;

  const changeable = ctx.booking.status === "confirmed" || ctx.booking.status === "pending";
  // Only fetch alternatives when there's something to move.
  const slots = changeable
    ? (
        await openSlots(client, ctx.page, ctx.eventType, {
          excludeBookingId: ctx.booking.id,
          excludeMeetingId: ctx.booking.meeting_id,
        })
      ).slots
    : [];

  const { meetingType: _meetingType, isActive: _isActive, sortOrder: _sortOrder, ...publicEventType } =
    serializeEventType(ctx.eventType);

  return {
    booking: serializeBooking({ ...ctx.booking, event_title: ctx.eventType.title }),
    page: serializePublicPage(ctx.page),
    eventType: publicEventType,
    hostTimezone: ctx.page.timezone,
    joinUrl: ctx.roomCode ? buildMeetingInviteUrl(SITE_URL, ctx.roomCode) : null,
    // Only the manage-token holder sees this, and it is their own name and email.
    bookingPageUrl: buildBookingPageUrl(SITE_URL, ctx.page.slug, undefined, {
      name: ctx.booking.invitee_name,
      email: ctx.booking.invitee_email,
    }),
    slots,
  };
}
