import {
  addDays,
  addMonths,
  dayKey,
  eventsForDay,
  groupByDay,
  isSameDay,
  isSameMonth,
  layoutDayEvents,
  monthMatrix,
  weekDays,
  weekdayLabels,
  applyCalendarFilter,
  emptyFilter,
  filterCountActive,
  typeMeta,
  type CalendarMeeting,
} from "./calendar";

function mkMeeting(over: Partial<CalendarMeeting> = {}): CalendarMeeting {
  return {
    id: over.id ?? "m1",
    room_code: "abc",
    title: "T",
    status: "waiting",
    host_id: "u1",
    created_at: "2026-01-01T00:00:00.000Z",
    started_at: null,
    ended_at: null,
    scheduled_at: null,
    duration_minutes: 60,
    timezone: null,
    meeting_type: "deal_review",
    attendees: null,
    preparation_status: null,
    followup_status: null,
    assigned_copilot_agent: null,
    is_draft: false,
    locked_at: null,
    updated_at: null,
    description: null,
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
    tags: null,
    external_calendar_provider: null,
    external_calendar_sync_enabled: null,
    external_calendar_sync_status: null,
    ...over,
  };
}

// A local-time ISO for a given Y/M/D H:M so day-bucketing is deterministic
// regardless of the test runner's zone (we build via the Date constructor,
// which interprets the numbers as local).
function localIso(y: number, mo: number, d: number, h = 0, mi = 0): string {
  return new Date(y, mo - 1, d, h, mi).toISOString();
}

describe("date primitives", () => {
  it("addDays / addMonths cross boundaries", () => {
    expect(dayKey(addDays(new Date(2026, 0, 31), 1))).toBe("2026-02-01");
    expect(dayKey(addMonths(new Date(2026, 0, 15), 1))).toBe("2026-02-15");
  });

  it("isSameDay / isSameMonth", () => {
    expect(isSameDay(new Date(2026, 5, 10, 9), new Date(2026, 5, 10, 23))).toBe(true);
    expect(isSameDay(new Date(2026, 5, 10), new Date(2026, 5, 11))).toBe(false);
    expect(isSameMonth(new Date(2026, 5, 1), new Date(2026, 5, 30))).toBe(true);
    expect(isSameMonth(new Date(2026, 5, 30), new Date(2026, 6, 1))).toBe(false);
  });
});

describe("monthMatrix", () => {
  it("is always 6×7 and starts on the configured week start", () => {
    const m = monthMatrix(new Date(2026, 6, 15), 0); // July 2026
    expect(m).toHaveLength(6);
    expect(m.every((w) => w.length === 7)).toBe(true);
    // Every first column is a Sunday when weekStartsOn = 0.
    expect(m.every((w) => w[0].getDay() === 0)).toBe(true);
    // The grid contains July 1.
    expect(m.flat().some((d) => isSameDay(d, new Date(2026, 6, 1)))).toBe(true);
  });

  it("honours a Monday week start", () => {
    const m = monthMatrix(new Date(2026, 6, 15), 1);
    expect(m.every((w) => w[0].getDay() === 1)).toBe(true);
  });
});

describe("weekDays / weekdayLabels", () => {
  it("returns 7 consecutive days from the week start", () => {
    const days = weekDays(new Date(2026, 6, 8), 0); // Wed Jul 8, 2026
    expect(days).toHaveLength(7);
    expect(days[0].getDay()).toBe(0);
    expect(dayKey(days[0])).toBe("2026-07-05");
    expect(dayKey(days[6])).toBe("2026-07-11");
  });

  it("rotates weekday labels", () => {
    expect(weekdayLabels(0)[0]).toBe("Sun");
    expect(weekdayLabels(1)[0]).toBe("Mon");
  });
});

describe("eventsForDay / groupByDay", () => {
  const meetings = [
    mkMeeting({ id: "a", scheduled_at: localIso(2026, 7, 10, 9, 0) }),
    mkMeeting({ id: "b", scheduled_at: localIso(2026, 7, 10, 8, 0) }),
    mkMeeting({ id: "c", scheduled_at: localIso(2026, 7, 11, 12, 0) }),
    mkMeeting({ id: "d", scheduled_at: null }),
  ];

  it("selects and sorts events on a day, ignoring unscheduled", () => {
    const day = new Date(2026, 6, 10);
    const evs = eventsForDay(meetings, day);
    expect(evs.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("buckets by day and skips unscheduled", () => {
    const g = groupByDay(meetings);
    expect(g.get("2026-07-10")?.map((m) => m.id)).toEqual(["b", "a"]);
    expect(g.get("2026-07-11")?.map((m) => m.id)).toEqual(["c"]);
    expect([...g.values()].flat().some((m) => m.id === "d")).toBe(false);
  });
});

describe("layoutDayEvents", () => {
  it("gives non-overlapping events a single lane", () => {
    const evs = [
      mkMeeting({ id: "a", scheduled_at: localIso(2026, 7, 10, 9, 0), duration_minutes: 60 }),
      mkMeeting({ id: "b", scheduled_at: localIso(2026, 7, 10, 11, 0), duration_minutes: 60 }),
    ];
    const layout = layoutDayEvents(evs);
    expect(layout.get("a")).toEqual({ lane: 0, lanes: 1 });
    expect(layout.get("b")).toEqual({ lane: 0, lanes: 1 });
  });

  it("splits two overlapping events into two lanes", () => {
    const evs = [
      mkMeeting({ id: "a", scheduled_at: localIso(2026, 7, 10, 9, 0), duration_minutes: 90 }),
      mkMeeting({ id: "b", scheduled_at: localIso(2026, 7, 10, 10, 0), duration_minutes: 60 }),
    ];
    const layout = layoutDayEvents(evs);
    expect(layout.get("a")!.lanes).toBe(2);
    expect(layout.get("b")!.lanes).toBe(2);
    expect(new Set([layout.get("a")!.lane, layout.get("b")!.lane])).toEqual(new Set([0, 1]));
  });

  it("reuses a freed lane after a cluster ends", () => {
    const evs = [
      mkMeeting({ id: "a", scheduled_at: localIso(2026, 7, 10, 9, 0), duration_minutes: 60 }),
      mkMeeting({ id: "b", scheduled_at: localIso(2026, 7, 10, 9, 30), duration_minutes: 60 }),
      mkMeeting({ id: "c", scheduled_at: localIso(2026, 7, 10, 13, 0), duration_minutes: 60 }),
    ];
    const layout = layoutDayEvents(evs);
    expect(layout.get("a")!.lanes).toBe(2);
    expect(layout.get("b")!.lanes).toBe(2);
    // c is in its own cluster → single lane.
    expect(layout.get("c")).toEqual({ lane: 0, lanes: 1 });
  });
});

describe("applyCalendarFilter", () => {
  const statusOf = (m: CalendarMeeting) => (m.status === "ended" ? "Completed" : "Scheduled");
  const meetings = [
    mkMeeting({ id: "mine-deal", host_id: "me", meeting_type: "deal_review", status: "waiting" }),
    mkMeeting({ id: "their-lp", host_id: "other", meeting_type: "lp_review", status: "ended" }),
    mkMeeting({ id: "mine-lp", host_id: "me", meeting_type: "lp_review", status: "waiting" }),
  ];

  it("passes everything through an empty filter", () => {
    expect(applyCalendarFilter(meetings, emptyFilter(), "me", statusOf)).toHaveLength(3);
    expect(filterCountActive(emptyFilter())).toBe(0);
  });

  it("filters by type", () => {
    const f = { ...emptyFilter(), types: new Set(["lp_review"]) };
    expect(applyCalendarFilter(meetings, f, "me", statusOf).map((m) => m.id)).toEqual(["their-lp", "mine-lp"]);
  });

  it("filters by mineOnly and status together", () => {
    const f = { types: new Set<string>(), statuses: new Set(["Scheduled"]), mineOnly: true };
    expect(applyCalendarFilter(meetings, f, "me", statusOf).map((m) => m.id)).toEqual(["mine-deal", "mine-lp"]);
    expect(filterCountActive(f)).toBe(2);
  });
});

describe("typeMeta", () => {
  it("falls back to 'other' for unknown/empty types", () => {
    expect(typeMeta(null).label).toBe("Other");
    expect(typeMeta("nonexistent").label).toBe("Other");
    expect(typeMeta("board_meeting").label).toBe("Board meeting");
  });
});
