import { bookingIdOf, isBookingRequest, moveRequestFor, requestToCalendarItem } from "./booking-requests";
import { canDragMeeting } from "./calendar-drag";

const REQUEST = {
  id: "bk-1",
  eventTitle: "Intro call",
  inviteeName: "Ada",
  inviteeEmail: "ada@example.com",
  inviteeNotes: "About the fund",
  startsAt: "2099-10-05T14:00:00.000Z",
  endsAt: "2099-10-05T14:30:00.000Z",
  createdAt: "2099-10-01T00:00:00.000Z",
};

describe("requestToCalendarItem", () => {
  const item = requestToCalendarItem(REQUEST, "host-1");

  it("draws the request at its time, as the host's, and says it is a request", () => {
    expect(item).toMatchObject({
      scheduled_at: REQUEST.startsAt,
      duration_minutes: 30,
      host_id: "host-1",
      title: "Request: Ada · Intro call",
      description: "About the fund",
    });
  });

  it("can be told apart from a meeting, and traced back to its booking", () => {
    expect(isBookingRequest(item)).toBe(true);
    expect(bookingIdOf(item)).toBe("bk-1");
    expect(isBookingRequest({ id: "4f1c0e9a-0000-4000-8000-000000000000" })).toBe(false);
    expect(bookingIdOf({ id: "4f1c0e9a-0000-4000-8000-000000000000" })).toBeNull();
  });

  it("is draggable like any upcoming meeting", () => {
    expect(canDragMeeting(item, Date.parse("2099-10-01T00:00:00.000Z"))).toBe(true);
  });
});

describe("moveRequestFor", () => {
  it("moves a request through the booking route, by its start only", () => {
    const item = requestToCalendarItem(REQUEST, "host-1");
    expect(moveRequestFor(item, "2099-10-06T09:00:00.000Z", 90, false)).toEqual({
      url: "/api/meetings/scheduling/bookings/bk-1",
      body: { action: "reschedule", startIso: "2099-10-06T09:00:00.000Z" },
    });
  });

  it("moves a meeting through its own route, with the dragged length", () => {
    expect(moveRequestFor({ id: "m-1" }, "2099-10-06T09:00:00.000Z", 90, true)).toEqual({
      url: "/api/meetings/m-1",
      body: { scheduledAt: "2099-10-06T09:00:00.000Z", durationMinutes: 90, allowConflict: true },
    });
  });
});
