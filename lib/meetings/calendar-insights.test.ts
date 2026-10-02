import {
  JOIN_LEAD_MS,
  calendarConflicts,
  conflictLabel,
  joinableNow,
  quickCreatePayload,
  swipeStep,
} from "./calendar-insights";

const at = (h: number, m = 0) => new Date(2026, 8, 16, h, m).toISOString();
const meeting = (id: string, start: string, minutes = 60, status = "waiting") => ({
  id,
  title: `Meeting ${id}`,
  scheduled_at: start,
  duration_minutes: minutes,
  status,
});

describe("calendarConflicts", () => {
  it("marks both sides of an overlap", () => {
    const c = calendarConflicts([meeting("a", at(10)), meeting("b", at(10, 30))], []);
    expect(c.get("a")?.meetings).toEqual(["Meeting b"]);
    expect(c.get("b")?.meetings).toEqual(["Meeting a"]);
  });

  it("does not call back-to-back a clash", () => {
    const c = calendarConflicts([meeting("a", at(10), 30), meeting("b", at(10, 30))], []);
    expect(c.size).toBe(0);
  });

  it("ignores meetings that have ended and ones with no time", () => {
    const c = calendarConflicts(
      [meeting("a", at(10), 60, "ended"), meeting("b", at(10, 15)), { ...meeting("c", at(10)), scheduled_at: null }],
      [],
    );
    expect(c.size).toBe(0);
  });

  it("finds every overlap in a pile-up, not only neighbours", () => {
    const c = calendarConflicts([meeting("a", at(9), 180), meeting("b", at(10)), meeting("c", at(11))], []);
    expect(c.get("a")?.meetings.sort()).toEqual(["Meeting b", "Meeting c"]);
    expect(c.get("b")?.meetings).toEqual(["Meeting a"]);
  });

  it("marks a meeting on busy time from a connected calendar, but not an all-day one", () => {
    const busy = [
      { id: "x", title: "Dentist", startsAt: at(10, 30), endsAt: at(11, 30) },
      { id: "y", title: "Offsite", startsAt: at(0), endsAt: at(23, 59), isAllDay: true },
    ];
    const c = calendarConflicts([meeting("a", at(10))], busy);
    expect(c.get("a")).toEqual({ meetings: [], busy: ["Dentist"] });
  });
});

describe("conflictLabel", () => {
  it("says what it clashes with", () => {
    expect(conflictLabel({ meetings: ["LP call"], busy: [] })).toBe("Overlaps LP call");
    expect(conflictLabel({ meetings: [], busy: ["Dentist"] })).toBe("Is during busy time (Dentist)");
    expect(conflictLabel({ meetings: ["A", "B", "C", "D"], busy: ["X"] })).toBe(
      "Overlaps A, B and 2 more and is during busy time (X)",
    );
    expect(conflictLabel(undefined)).toBeNull();
  });
});

describe("joinableNow", () => {
  const start = Date.parse(at(10));
  const m = meeting("a", at(10), 30);

  it("opens the lead window before the start and closes at the end", () => {
    expect(joinableNow(m, start - JOIN_LEAD_MS - 1)).toBe(false);
    expect(joinableNow(m, start - JOIN_LEAD_MS)).toBe(true);
    expect(joinableNow(m, start + 29 * 60_000)).toBe(true);
    expect(joinableNow(m, start + 30 * 60_000)).toBe(false);
  });

  it("is open whenever someone is in the room, and never once it has ended", () => {
    expect(joinableNow(m, start + 5 * 3_600_000, 2)).toBe(true);
    expect(joinableNow({ ...m, status: "ended" }, start, 2)).toBe(false);
  });
});

describe("quickCreatePayload", () => {
  it("builds the schedule route's body in the grid's own zone", () => {
    const p = quickCreatePayload({
      title: "  Intro with Rae ",
      start: new Date(2026, 8, 16, 14, 30),
      minutes: 45,
      attendees: [{ name: "rae", email: "rae@acme.com", type: "external" }],
      timezone: "America/New_York",
    });
    expect(p).toEqual({
      title: "Intro with Rae",
      meetingType: "internal_strategy",
      date: "2026-09-16",
      startTime: "14:30",
      endTime: "15:15",
      timezone: "America/New_York",
      attendees: [{ name: "rae", email: "rae@acme.com", type: "external" }],
    });
  });

  it("keeps a late slot on its own day", () => {
    const p = quickCreatePayload({ title: "Late", start: new Date(2026, 8, 16, 23, 30), minutes: 60, timezone: "UTC" });
    expect(p.endTime).toBe("23:59");
  });
});

describe("swipeStep", () => {
  it("moves forward on a left swipe and back on a right one", () => {
    expect(swipeStep(-120, 10)).toBe(1);
    expect(swipeStep(120, -5)).toBe(-1);
  });

  it("ignores short gestures and scrolls that drift sideways", () => {
    expect(swipeStep(-40, 0)).toBe(0);
    expect(swipeStep(-90, 200)).toBe(0);
  });
});
