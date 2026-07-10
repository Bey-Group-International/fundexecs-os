import {
  CALENDAR_DEFAULTS,
  zonedDateKey,
  formatClock,
  isWeekend,
  formatDayHeading,
  groupByDay,
} from "./calendar-preferences";

describe("calendar preferences", () => {
  it("mirrors the institutional Google Calendar defaults", () => {
    expect(CALENDAR_DEFAULTS).toEqual({
      timezone: "America/Chicago",
      defaultDurationMinutes: 60,
      weekStartsOn: 0,
      dateOrder: "MDY",
      hour12: true,
      showWeekends: true,
      showDeclined: true,
    });
  });

  it("keys a UTC instant to the local calendar day in the zone", () => {
    // 02:00 UTC on the 10th is 21:00 (9 PM) on the 9th in America/Chicago.
    expect(zonedDateKey("2026-07-10T02:00:00.000Z", "America/Chicago")).toBe("2026-07-09");
    expect(zonedDateKey("2026-07-10T02:00:00.000Z", "UTC")).toBe("2026-07-10");
  });

  it("formats the clock as 12-hour by default and 24-hour when configured", () => {
    const iso = "2026-07-10T02:52:00.000Z"; // 21:52 in Chicago (CDT)
    expect(formatClock(iso)).toBe("9:52 PM");
    expect(formatClock(iso, { ...CALENDAR_DEFAULTS, hour12: false })).toBe("21:52");
  });

  it("detects weekends in the configured zone", () => {
    // 2026-07-11 is a Saturday.
    expect(isWeekend("2026-07-11T15:00:00.000Z")).toBe(true);
    // 2026-07-10 is a Friday.
    expect(isWeekend("2026-07-10T15:00:00.000Z")).toBe(false);
  });

  it("labels today and tomorrow, else a weekday heading", () => {
    const now = new Date("2026-07-10T15:00:00.000Z").getTime(); // Fri Jul 10 (Chicago)
    expect(formatDayHeading("2026-07-10T18:00:00.000Z", CALENDAR_DEFAULTS, now)).toBe("Today");
    expect(formatDayHeading("2026-07-11T18:00:00.000Z", CALENDAR_DEFAULTS, now)).toBe("Tomorrow");
    expect(formatDayHeading("2026-07-13T18:00:00.000Z", CALENDAR_DEFAULTS, now)).toBe("Mon, Jul 13");
  });

  describe("groupByDay", () => {
    const now = new Date("2026-07-10T12:00:00.000Z").getTime();
    const meetings = [
      { id: "b", scheduled_at: "2026-07-11T16:00:00.000Z" }, // Sat
      { id: "a2", scheduled_at: "2026-07-10T20:00:00.000Z" }, // Fri later
      { id: "a1", scheduled_at: "2026-07-10T15:00:00.000Z" }, // Fri earlier
      { id: "none", scheduled_at: null },
    ];

    it("buckets by day and sorts days + items chronologically", () => {
      const groups = groupByDay(meetings, CALENDAR_DEFAULTS, now);
      expect(groups.map((g) => g.key)).toEqual(["2026-07-10", "2026-07-11"]);
      expect(groups[0].items.map((m) => m.id)).toEqual(["a1", "a2"]);
      expect(groups[0].heading).toBe("Today");
    });

    it("omits weekend days when showWeekends is false", () => {
      const groups = groupByDay(meetings, { ...CALENDAR_DEFAULTS, showWeekends: false }, now);
      expect(groups.map((g) => g.key)).toEqual(["2026-07-10"]);
    });
  });
});
