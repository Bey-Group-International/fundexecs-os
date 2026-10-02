// lib/meetings/booking-requests.ts
// Pending scheduling-link requests, drawn on the host's own calendar.
//
// A request has no meeting room until the host approves it, so it was nowhere
// on the calendar: the host could see it only in the booking card, and could
// move it only by typing a new time there. Drawn here as a calendar item, it
// sits among the host's real commitments and can be dragged like any meeting.
//
// The item is shaped like a CalendarMeeting so the grid, the agenda and the drag
// machinery need nothing new — but its id is prefixed, and every place where a
// request behaves differently from a meeting (moving it, opening it, resizing
// it) asks `isBookingRequest` first.
import type { CalendarMeeting } from "@/lib/meetings/calendar";

/** Prefix on a request's calendar id; never a valid live_meetings uuid. */
const ID_PREFIX = "booking:";

/** Tag every request carries, so filters and readers can tell it apart. */
export const BOOKING_REQUEST_TAG = "booking-request";

/** What the calendar needs of a pending booking (the host API's shape). */
export interface PendingBookingRequest {
  id: string;
  eventTitle: string | null;
  inviteeName: string;
  inviteeEmail: string;
  inviteeNotes: string | null;
  startsAt: string;
  endsAt: string;
  createdAt: string;
}

export function isBookingRequest(m: Pick<CalendarMeeting, "id">): boolean {
  return m.id.startsWith(ID_PREFIX);
}

/** The scheduling_bookings id behind a request's calendar item. */
export function bookingIdOf(m: Pick<CalendarMeeting, "id">): string | null {
  return isBookingRequest(m) ? m.id.slice(ID_PREFIX.length) : null;
}

export function requestToCalendarItem(request: PendingBookingRequest, hostUserId: string): CalendarMeeting {
  const minutes = Math.max(
    5,
    Math.round((new Date(request.endsAt).getTime() - new Date(request.startsAt).getTime()) / 60_000),
  );
  return {
    id: `${ID_PREFIX}${request.id}`,
    room_code: "",
    title: `Request: ${request.inviteeName}${request.eventTitle ? ` · ${request.eventTitle}` : ""}`,
    status: "waiting",
    host_id: hostUserId,
    created_at: request.createdAt,
    started_at: null,
    ended_at: null,
    scheduled_at: request.startsAt,
    duration_minutes: minutes,
    timezone: null,
    meeting_type: "other",
    attendees: [{ name: request.inviteeName, email: request.inviteeEmail, type: "external" }],
    preparation_status: null,
    followup_status: null,
    assigned_copilot_agent: null,
    is_draft: false,
    locked_at: null,
    updated_at: null,
    description: request.inviteeNotes,
    location: null,
    meeting_url: null,
    objective: null,
    agenda: null,
    preparation_requirements: null,
    related_record_type: null,
    related_record_id: null,
    calendar_visibility: null,
    reminder_minutes: null,
    priority: null,
    tags: [BOOKING_REQUEST_TAG],
    external_calendar_provider: null,
    external_calendar_sync_enabled: null,
    external_calendar_sync_status: null,
  };
}

/**
 * The PATCH a drop on the calendar sends. A meeting moves through its own route
 * with the dragged length; a request moves through the booking route with its
 * start only — its length is the meeting type's, and the route emails the
 * invitee the new time.
 */
export function moveRequestFor(
  m: Pick<CalendarMeeting, "id">,
  startIso: string,
  durationMinutes: number,
  allowConflict: boolean,
): { url: string; body: Record<string, unknown> } {
  const override = allowConflict ? { allowConflict: true } : {};
  const bookingId = bookingIdOf(m);
  if (bookingId) {
    return {
      url: `/api/meetings/scheduling/bookings/${bookingId}`,
      body: { action: "reschedule", startIso, ...override },
    };
  }
  return { url: `/api/meetings/${m.id}`, body: { scheduledAt: startIso, durationMinutes, ...override } };
}
