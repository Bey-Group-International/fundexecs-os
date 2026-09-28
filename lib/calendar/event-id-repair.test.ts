import {
  NO_REPAIRS,
  byHost,
  countOutcome,
  needsEventId,
  summarize,
  worthReporting,
  type RepairableMeeting,
  type RepairStats,
} from "./event-id-repair";

const meeting = (over: Partial<RepairableMeeting> = {}): RepairableMeeting => ({
  id: "mtg-1",
  host_id: "host-1",
  external_calendar_sync_enabled: true,
  external_calendar_event_id: null,
  deleted_at: null,
  is_draft: false,
  ...over,
});

describe("needsEventId", () => {
  it("is true for a synced meeting whose row never learned its event id", () => {
    // The exact shape the constraint violation left behind: the event is on the
    // calendar, the UPDATE that would have recorded it was thrown out.
    expect(needsEventId(meeting())).toBe(true);
  });

  it("is false once the id is on the row", () => {
    expect(needsEventId(meeting({ external_calendar_event_id: "evt-1" }))).toBe(false);
  });

  it("is false when sync was never on", () => {
    // Nothing was ever pushed, so nothing is missing.
    expect(needsEventId(meeting({ external_calendar_sync_enabled: false }))).toBe(false);
    expect(needsEventId(meeting({ external_calendar_sync_enabled: null }))).toBe(false);
  });

  it("is false for a draft, which was never pushed", () => {
    expect(needsEventId(meeting({ is_draft: true }))).toBe(false);
  });

  it("is false for a deleted meeting, whose event has its own removal path", () => {
    expect(needsEventId(meeting({ deleted_at: "2026-09-01T00:00:00.000Z" }))).toBe(false);
  });

  it("is false without a host, because there is no calendar to look in", () => {
    // The event lives on somebody's personal calendar. With no host there is no
    // connection, no token and nowhere to search.
    expect(needsEventId(meeting({ host_id: null }))).toBe(false);
    expect(needsEventId(meeting({ host_id: "" }))).toBe(false);
  });
});

describe("byHost", () => {
  it("groups the work by whose calendar it is on", () => {
    // One connection, one token and one calendar lookup per host rather than
    // per meeting.
    const grouped = byHost([
      meeting({ id: "a", host_id: "h1" }),
      meeting({ id: "b", host_id: "h2" }),
      meeting({ id: "c", host_id: "h1" }),
    ]);
    expect([...grouped.keys()]).toEqual(["h1", "h2"]);
    expect(grouped.get("h1")!.map((m) => m.id)).toEqual(["a", "c"]);
    expect(grouped.get("h2")!.map((m) => m.id)).toEqual(["b"]);
  });

  it("drops the rows that do not need repairing", () => {
    const grouped = byHost([
      meeting({ id: "keep" }),
      meeting({ id: "has-id", external_calendar_event_id: "evt" }),
      meeting({ id: "draft", is_draft: true }),
      meeting({ id: "hostless", host_id: null }),
    ]);
    expect(grouped.size).toBe(1);
    expect(grouped.get("host-1")!.map((m) => m.id)).toEqual(["keep"]);
  });

  it("leaves a host out entirely when none of their meetings qualify", () => {
    const grouped = byHost([
      meeting({ id: "a", host_id: "h1", external_calendar_event_id: "evt" }),
    ]);
    expect(grouped.size).toBe(0);
  });

  it("keeps the order it was given, so newest-first stays newest-first", () => {
    const grouped = byHost([
      meeting({ id: "newest", host_id: "h1" }),
      meeting({ id: "older", host_id: "h1" }),
    ]);
    expect(grouped.get("h1")!.map((m) => m.id)).toEqual(["newest", "older"]);
  });

  it("is empty for an empty list", () => {
    expect(byHost([]).size).toBe(0);
  });
});

describe("countOutcome", () => {
  it("counts each outcome and every examination", () => {
    let stats = NO_REPAIRS;
    stats = countOutcome(stats, "reattached");
    stats = countOutcome(stats, "reattached");
    stats = countOutcome(stats, "noEvent");
    stats = countOutcome(stats, "noCalendar");
    stats = countOutcome(stats, "failed");

    expect(stats).toMatchObject({
      examined: 5,
      reattached: 2,
      noEvent: 1,
      noCalendar: 1,
      failed: 1,
    });
  });

  it("does not mutate the totals it was given", () => {
    const before = countOutcome(NO_REPAIRS, "reattached");
    countOutcome(before, "failed");
    expect(before).toMatchObject({ examined: 1, reattached: 1, failed: 0 });
    expect(NO_REPAIRS.examined).toBe(0);
  });
});

describe("worthReporting", () => {
  it("is quiet when there was nothing to do", () => {
    // An hourly job that logs "0 of 0" forever teaches everyone to ignore it,
    // which is how the next real number goes unread.
    expect(worthReporting(NO_REPAIRS)).toBe(false);
  });

  it("speaks up as soon as it examined anything", () => {
    expect(worthReporting(countOutcome(NO_REPAIRS, "noEvent"))).toBe(true);
  });
});

describe("summarize", () => {
  const stats = (over: Partial<RepairStats> = {}): RepairStats => ({ ...NO_REPAIRS, ...over });

  it("leads with what it fixed", () => {
    expect(summarize(stats({ examined: 3, reattached: 3 }))).toBe("3 reattached of 3 examined");
  });

  it("names each thing it could not fix, and only those", () => {
    expect(summarize(stats({ examined: 4, reattached: 1, noEvent: 1, noCalendar: 1, failed: 1 })))
      .toBe("1 reattached, 1 with no event, 1 with no calendar, 1 failed of 4 examined");
  });

  it("says when a backlog remains, so the next sweep is expected", () => {
    expect(summarize(stats({ examined: 25, reattached: 25, more: true })))
      .toBe("25 reattached of 25 examined; more remain");
  });

  it("still reads sensibly when it fixed nothing", () => {
    expect(summarize(stats({ examined: 2, noCalendar: 2 })))
      .toBe("0 reattached, 2 with no calendar of 2 examined");
  });
});
