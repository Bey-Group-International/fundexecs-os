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

import { busyIntervals } from "./scheduling-service";

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
