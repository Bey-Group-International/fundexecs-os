import {
  LAYER_PALETTE,
  type CalendarLayer,
  type ExternalEvent,
  allDayEventsForDay,
  colorForLayer,
  eventSpansForDay,
  groupLayers,
  layerIndex,
  layerNeedsAttention,
  visibleEvents,
} from "./layers";

const layer = (over: Partial<CalendarLayer> = {}): CalendarLayer => ({
  id: "l1",
  source: "google",
  name: "Work",
  color: "#0b8043",
  isVisible: true,
  blocksAvailability: true,
  isPrimary: false,
  canWrite: true,
  health: { state: "ok", message: null },
  ...over,
});

const event = (over: Partial<ExternalEvent> = {}): ExternalEvent => ({
  id: "e1",
  calendarId: "l1",
  title: "Board call",
  location: null,
  link: null,
  startsAt: "2026-09-01T09:00:00.000Z",
  endsAt: "2026-09-01T10:00:00.000Z",
  isAllDay: false,
  isBusy: true,
  ...over,
});

describe("colorForLayer", () => {
  it("keeps Google's own colour, so a member's coding survives", () => {
    expect(colorForLayer({ id: "l1", color: "#0b8043" })).toBe("#0b8043");
  });

  // A colour is only worth learning if it stays put.
  it("assigns a colourless layer the same colour every time", () => {
    const first = colorForLayer({ id: "feed-abc", color: null });
    expect(colorForLayer({ id: "feed-abc", color: null })).toBe(first);
    expect(LAYER_PALETTE).toContain(first as (typeof LAYER_PALETTE)[number]);
  });

  it("spreads different layers across the palette", () => {
    const seen = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => colorForLayer({ id, color: null })),
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("groupLayers", () => {
  it("splits by what the member can actually write to", () => {
    const groups = groupLayers([
      layer({ id: "mine", canWrite: true }),
      layer({ id: "shared", canWrite: false, name: "Team" }),
    ]);
    expect(groups.map((g) => g.title)).toEqual(["My calendars", "Other calendars"]);
    expect(groups[0].layers.map((l) => l.id)).toEqual(["mine"]);
    expect(groups[1].layers.map((l) => l.id)).toEqual(["shared"]);
  });

  it("counts the primary calendar as the member's own even without write access", () => {
    const groups = groupLayers([layer({ id: "p", canWrite: false, isPrimary: true })]);
    expect(groups[0].title).toBe("My calendars");
  });

  it("omits a group with nothing in it rather than showing an empty heading", () => {
    expect(groupLayers([layer({ canWrite: true })]).map((g) => g.title)).toEqual(["My calendars"]);
    expect(groupLayers([])).toEqual([]);
  });
});

// A broken calendar shows nothing, which looks exactly like an empty one.
describe("layerNeedsAttention", () => {
  it("flags a failing layer", () => {
    expect(layerNeedsAttention(layer({ health: { state: "failing", message: "x" } }))).toBe(true);
  });

  it("flags a revoked grant", () => {
    expect(layerNeedsAttention(layer({ health: { state: "reauth_required", message: "x" } }))).toBe(true);
  });

  it("leaves a merely stale layer alone", () => {
    expect(layerNeedsAttention(layer({ health: { state: "stale", message: "x" } }))).toBe(false);
    expect(layerNeedsAttention(layer())).toBe(false);
  });
});

describe("visibleEvents", () => {
  it("drops events whose layer is hidden", () => {
    const events = [event({ id: "a", calendarId: "shown" }), event({ id: "b", calendarId: "hidden" })];
    const layers = [layer({ id: "shown", isVisible: true }), layer({ id: "hidden", isVisible: false })];
    expect(visibleEvents(events, layers).map((e) => e.id)).toEqual(["a"]);
  });

  it("drops an event whose layer is gone entirely", () => {
    expect(visibleEvents([event({ calendarId: "vanished" })], [layer({ id: "l1" })])).toEqual([]);
  });
});

describe("layerIndex", () => {
  it("indexes by id so the grid can colour each event", () => {
    const idx = layerIndex([layer({ id: "l1" }), layer({ id: "l2" })]);
    expect(idx.get("l2")?.id).toBe("l2");
    expect(idx.get("nope")).toBeUndefined();
  });
});

describe("eventSpansForDay", () => {
  // Local-time day boundaries: the grid draws a member's day, not UTC's.
  const day = new Date(2026, 8, 1);

  const localEvent = (startHour: number, endHour: number, over: Partial<ExternalEvent> = {}) =>
    event({
      startsAt: new Date(2026, 8, 1, startHour).toISOString(),
      endsAt: new Date(2026, 8, 1, endHour).toISOString(),
      ...over,
    });

  it("places an event on the day's minute rail", () => {
    const [span] = eventSpansForDay([localEvent(9, 10)], day);
    expect(span.startMinute).toBe(540);
    expect(span.endMinute).toBe(600);
  });

  it("ignores an event on another day", () => {
    const other = event({
      startsAt: new Date(2026, 8, 5, 9).toISOString(),
      endsAt: new Date(2026, 8, 5, 10).toISOString(),
    });
    expect(eventSpansForDay([other], day)).toEqual([]);
  });

  // An overnight event must draw to the edge, not overflow the column.
  it("clamps an event that starts the day before", () => {
    const overnight = event({
      startsAt: new Date(2026, 7, 31, 22).toISOString(),
      endsAt: new Date(2026, 8, 1, 2).toISOString(),
    });
    const [span] = eventSpansForDay([overnight], day);
    expect(span.startMinute).toBe(0);
    expect(span.endMinute).toBe(120);
  });

  it("clamps an event that runs past midnight", () => {
    const overnight = event({
      startsAt: new Date(2026, 8, 1, 23).toISOString(),
      endsAt: new Date(2026, 8, 2, 3).toISOString(),
    });
    const [span] = eventSpansForDay([overnight], day);
    expect(span.startMinute).toBe(1380);
    expect(span.endMinute).toBe(1440);
  });

  it("gives a very short event a floor so it stays clickable", () => {
    const brief = event({
      startsAt: new Date(2026, 8, 1, 9, 0).toISOString(),
      endsAt: new Date(2026, 8, 1, 9, 2).toISOString(),
    });
    const [span] = eventSpansForDay([brief], day);
    expect(span.endMinute - span.startMinute).toBe(15);
  });

  it("leaves all-day events to the banner", () => {
    expect(eventSpansForDay([localEvent(9, 10, { isAllDay: true })], day)).toEqual([]);
  });

  it("skips events it cannot place rather than drawing them at midnight", () => {
    expect(eventSpansForDay([event({ startsAt: "nonsense", endsAt: "also nonsense" })], day)).toEqual([]);
  });

  it("returns spans in start order", () => {
    const spans = eventSpansForDay([localEvent(15, 16, { id: "late" }), localEvent(9, 10, { id: "early" })], day);
    expect(spans.map((s) => s.event.id)).toEqual(["early", "late"]);
  });
});

describe("allDayEventsForDay", () => {
  const day = new Date(2026, 8, 1);

  it("finds an all-day event covering the day", () => {
    const banner = event({
      isAllDay: true,
      startsAt: new Date(2026, 8, 1).toISOString(),
      endsAt: new Date(2026, 8, 2).toISOString(),
    });
    expect(allDayEventsForDay([banner], day)).toHaveLength(1);
  });

  it("finds a multi-day event on each day it spans", () => {
    const banner = event({
      isAllDay: true,
      startsAt: new Date(2026, 7, 30).toISOString(),
      endsAt: new Date(2026, 8, 4).toISOString(),
    });
    expect(allDayEventsForDay([banner], day)).toHaveLength(1);
    expect(allDayEventsForDay([banner], new Date(2026, 8, 3))).toHaveLength(1);
    expect(allDayEventsForDay([banner], new Date(2026, 8, 9))).toHaveLength(0);
  });

  it("leaves timed events to the rail", () => {
    expect(allDayEventsForDay([event({ isAllDay: false })], day)).toEqual([]);
  });
});
