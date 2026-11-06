import { bookingDayLabel, bookingsByDay, nextBookingLabel } from "./booking-days";

const NOW = new Date("2026-11-06T10:00:00Z");

describe("bookingDayLabel", () => {
  it("says today and tomorrow, and the date after that", () => {
    expect(bookingDayLabel("2026-11-06T15:00:00Z", "UTC", NOW)).toBe("Today");
    expect(bookingDayLabel("2026-11-07T09:00:00Z", "UTC", NOW)).toBe("Tomorrow");
    expect(bookingDayLabel("2026-11-09T09:00:00Z", "UTC", NOW)).toMatch(/November 9/);
  });

  it("reads the day in the host's zone", () => {
    // 23:30Z on the 6th is already the 7th in Tokyo, where it is also already the 6th now.
    expect(bookingDayLabel("2026-11-06T23:30:00Z", "Asia/Tokyo", NOW)).toBe("Tomorrow");
  });
});

describe("bookingsByDay", () => {
  it("sorts and groups, keeping each row whole", () => {
    const rows = [
      { id: "c", startsAt: "2026-11-07T09:00:00Z" },
      { id: "a", startsAt: "2026-11-06T11:00:00Z" },
      { id: "b", startsAt: "2026-11-06T16:00:00Z" },
    ];
    expect(bookingsByDay(rows, "UTC", NOW).map((d) => [d.label, d.bookings.map((b) => b.id)])).toEqual([
      ["Today", ["a", "b"]],
      ["Tomorrow", ["c"]],
    ]);
  });
});

describe("nextBookingLabel", () => {
  it("names the next one still to come", () => {
    expect(
      nextBookingLabel([{ startsAt: "2026-11-06T08:00:00Z" }, { startsAt: "2026-11-07T09:30:00Z" }], "UTC", NOW),
    ).toBe("Tomorrow 9:30 AM");
    expect(nextBookingLabel([{ startsAt: "2026-11-05T08:00:00Z" }], "UTC", NOW)).toBeNull();
  });
});
