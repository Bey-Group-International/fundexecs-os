// lib/meetings/scheduling-service.test.ts
// The one thing this file has to prove: every calendar the host has actually
// holds their time. A busy source that is queried but never consulted looks
// exactly like a free host, and a free host gets double-booked.
const externalBusyForUserMock = jest.fn();
const googleBusyForUserMock = jest.fn();

jest.mock("next/headers", () => ({ cookies: () => ({ getAll: () => [], set: () => undefined }) }));
jest.mock("@/lib/calendar/feeds.server", () => ({
  externalBusyForUser: (...a: unknown[]) => externalBusyForUserMock(...a),
}));
jest.mock("@/lib/calendar/google.server", () => ({
  googleBusyForUser: (...a: unknown[]) => googleBusyForUserMock(...a),
}));

import { busyIntervals, rescheduleBooking, resolvePublicPage, SlotUnavailableError } from "./scheduling-service";
import type { BookingContext } from "./scheduling-service";

const WINDOW = {
  hostUserId: "host-1",
  fromIso: "2026-09-02T00:00:00.000Z",
  toIso: "2026-09-03T00:00:00.000Z",
  timezone: "America/New_York",
};

/** Answers each table from a queue, so the three reads can differ. */
function fakeClient(byTable: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const b: Record<string, unknown> = new Proxy(
        {
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve({ data: byTable[table] ?? [], error: null }).then(res, rej),
        },
        {
          get(target: Record<string, unknown>, prop: string) {
            if (prop in target) return target[prop];
            return () => b;
          },
        },
      ) as Record<string, unknown>;
      return b;
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  externalBusyForUserMock.mockResolvedValue([]);
  googleBusyForUserMock.mockResolvedValue([]);
});

describe("busyIntervals", () => {
  it("blocks time held in a connected Google calendar", async () => {
    googleBusyForUserMock.mockResolvedValue([
      { start: "2026-09-02T14:00:00.000Z", end: "2026-09-02T15:00:00.000Z" },
    ]);
    const busy = await busyIntervals(fakeClient({}) as never, WINDOW);
    expect(busy).toContainEqual({ start: "2026-09-02T14:00:00.000Z", end: "2026-09-02T15:00:00.000Z" });
  });

  it("blocks time held in a subscribed feed", async () => {
    externalBusyForUserMock.mockResolvedValue([
      { start: "2026-09-02T16:00:00.000Z", end: "2026-09-02T17:00:00.000Z" },
    ]);
    const busy = await busyIntervals(fakeClient({}) as never, WINDOW);
    expect(busy).toContainEqual({ start: "2026-09-02T16:00:00.000Z", end: "2026-09-02T17:00:00.000Z" });
  });

  // All-day events are stored at UTC midnight, so a busy source that is not
  // told the host's zone blocks the wrong hours.
  it("tells both external sources which zone the host publishes in", async () => {
    await busyIntervals(fakeClient({}) as never, WINDOW);
    expect(externalBusyForUserMock).toHaveBeenCalledWith(expect.anything(), "host-1", {
      fromIso: WINDOW.fromIso,
      toIso: WINDOW.toIso,
      timezone: "America/New_York",
    });
    expect(googleBusyForUserMock).toHaveBeenCalledWith(
      expect.anything(),
      "host-1",
      new Date(WINDOW.fromIso),
      new Date(WINDOW.toIso),
      "America/New_York",
    );
  });

  // A public slot lookup waits on this. The connected-calendar reads do not
  // depend on the host's own rows, so they must not queue behind them.
  it("starts the connected-calendar reads without waiting for the host's own rows", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow = fakeClient({});
    const from = slow.from.bind(slow);
    slow.from = (table: string) => {
      const b = from(table) as Record<string, unknown>;
      return new Proxy(b, {
        get(target, prop: string) {
          if (prop === "then") {
            return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              gate.then(() => ({ data: [], error: null })).then(res, rej);
          }
          return target[prop];
        },
      });
    };

    const pending = busyIntervals(slow as never, WINDOW);
    await Promise.resolve();
    expect(externalBusyForUserMock).toHaveBeenCalled();
    expect(googleBusyForUserMock).toHaveBeenCalled();

    release();
    await pending;
  });

  it("keeps blocking internal time when a third-party lookup comes back empty", async () => {
    const busy = await busyIntervals(
      fakeClient({
        live_meetings: [{ scheduled_at: "2026-09-02T09:00:00.000Z", duration_minutes: 30 }],
      }) as never,
      WINDOW,
    );
    expect(busy).toContainEqual({ start: "2026-09-02T09:00:00.000Z", end: "2026-09-02T09:30:00.000Z" });
  });

  it("does not let the booking being rescheduled block its own new time", async () => {
    const busy = await busyIntervals(
      fakeClient({
        scheduling_bookings: [
          { id: "b1", starts_at: "2026-09-02T09:00:00.000Z", ends_at: "2026-09-02T09:30:00.000Z" },
        ],
      }) as never,
      { ...WINDOW, excludeBookingId: "b1" },
    );
    expect(busy).toEqual([]);
  });
});

describe("resolvePublicPage", () => {
  // Every public booking-page view and slot lookup goes through here, so the
  // page and its event types must come back from ONE query, not two.
  it("reads the page and its event types in a single query", async () => {
    const calls: { table: string; select?: string; orders: unknown[] }[] = [];
    const client = {
      from(table: string) {
        const call = { table, select: undefined as string | undefined, orders: [] as unknown[] };
        calls.push(call);
        const b: Record<string, unknown> = {
          select: (cols: string) => { call.select = cols; return b; },
          eq: () => b,
          order: (col: string, opts: unknown) => { call.orders.push([col, opts]); return b; },
          maybeSingle: async () => ({
            data: {
              id: "p1", slug: "ana", is_active: true,
              scheduling_event_types: [
                { id: "e1", slug: "intro", is_active: true },
                { id: "e2", slug: "old", is_active: false },
              ],
            },
            error: null,
          }),
        };
        return b;
      },
    };

    const resolved = await resolvePublicPage(client as never, "Ana");

    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe("scheduling_pages");
    expect(calls[0].select).toContain("scheduling_event_types(");
    expect(calls[0].orders).toEqual([
      ["sort_order", { referencedTable: "scheduling_event_types", ascending: true }],
      ["created_at", { referencedTable: "scheduling_event_types", ascending: true }],
    ]);
    // Only active event types, and the page without the embedded array on it.
    expect(resolved?.eventTypes.map((t) => t.id)).toEqual(["e1"]);
    expect(resolved?.page).toEqual({ id: "p1", slug: "ana", is_active: true });
  });

  it("returns null for a handle with no active page", async () => {
    const b: Record<string, unknown> = {};
    Object.assign(b, { select: () => b, eq: () => b, order: () => b, maybeSingle: async () => ({ data: null, error: null }) });
    expect(await resolvePublicPage({ from: () => b } as never, "nobody")).toBeNull();
  });
});

describe("rescheduleBooking", () => {
  /**
   * Records every write and answers each table's writes from a queue, so a test
   * can make the booking row reject a move the way the overlap constraint does.
   */
  function recordingClient(results: Record<string, Array<{ data: unknown; error: unknown }>>) {
    const writes: Array<{ table: string; patch: Record<string, unknown> }> = [];
    return {
      writes,
      from(table: string) {
        const b: Record<string, unknown> = new Proxy(
          {
            update(patch: Record<string, unknown>) {
              writes.push({ table, patch });
              return b;
            },
            then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              Promise.resolve(results[table]?.shift() ?? { data: null, error: null }).then(res, rej),
          },
          {
            get(target: Record<string, unknown>, prop: string) {
              if (prop in target) return target[prop];
              return () => b;
            },
          },
        ) as Record<string, unknown>;
        return b;
      },
    };
  }

  const ctx = {
    booking: {
      id: "bk-1",
      meeting_id: "mtg-1",
      status: "confirmed",
      starts_at: "2026-10-05T14:00:00.000Z",
      ends_at: "2026-10-05T14:30:00.000Z",
      rescheduled_at: null,
    },
    page: { id: "page-1", user_id: "host-1", timezone: "UTC" },
    eventType: { id: "et-1", duration_minutes: 30 },
    roomCode: "abc-defg-hij",
  } as unknown as BookingContext;

  it("leaves the room where it is when the database rejects the new time", async () => {
    const client = recordingClient({
      scheduling_bookings: [{ data: null, error: { code: "23P01", message: "conflicting key value" } }],
    });

    await expect(
      rescheduleBooking(client as never, ctx, "2026-10-05T16:00:00.000Z", { enforceAvailability: false }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);

    // The booking row is the arbiter; nothing else may move until it has.
    expect(client.writes.filter((w) => w.table === "live_meetings")).toEqual([]);
  });

  it("moves the booking back if the room can't follow it", async () => {
    const moved = { ...ctx.booking, starts_at: "2026-10-05T16:00:00.000Z", ends_at: "2026-10-05T16:30:00.000Z" };
    const client = recordingClient({
      scheduling_bookings: [{ data: moved, error: null }, { data: ctx.booking, error: null }],
      live_meetings: [{ data: null, error: { message: "network" } }],
    });

    await expect(
      rescheduleBooking(client as never, ctx, "2026-10-05T16:00:00.000Z", { enforceAvailability: false }),
    ).rejects.toThrow("network");

    const bookingWrites = client.writes.filter((w) => w.table === "scheduling_bookings");
    expect(bookingWrites).toHaveLength(2);
    expect(bookingWrites[1].patch).toMatchObject({
      starts_at: "2026-10-05T14:00:00.000Z",
      ends_at: "2026-10-05T14:30:00.000Z",
      rescheduled_at: null,
    });
  });

  it("moves the booking, then the room, on the happy path", async () => {
    const moved = { ...ctx.booking, starts_at: "2026-10-05T16:00:00.000Z", ends_at: "2026-10-05T16:30:00.000Z" };
    const client = recordingClient({ scheduling_bookings: [{ data: moved, error: null }] });

    const next = await rescheduleBooking(client as never, ctx, "2026-10-05T16:00:00.000Z", {
      enforceAvailability: false,
    });

    expect(next.booking.starts_at).toBe("2026-10-05T16:00:00.000Z");
    expect(client.writes.map((w) => w.table)).toEqual(["scheduling_bookings", "live_meetings"]);
    expect(client.writes[1].patch).toMatchObject({ scheduled_at: "2026-10-05T16:00:00.000Z" });
  });
});
