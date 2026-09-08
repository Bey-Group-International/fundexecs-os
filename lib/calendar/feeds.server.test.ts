// lib/calendar/feeds.server.test.ts
// Fetching a stranger's calendar URL and turning it into busy time. The cases
// that matter are the failures: a feed that quietly imports nothing is
// indistinguishable from a free calendar, and that is how double-bookings get
// booked.
import {
  applyFeedEvents,
  cachedBusyOf,
  externalBusyForUser,
  fetchFeed,
  recordFeedResult,
  refreshStaleFeeds,
} from "./feeds.server";
import type { IcsEvent } from "./ics";

const fetchMock = jest.fn();
const NOW = new Date("2026-09-01T12:00:00.000Z");

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

/** A minimal Response stand-in that takes readCapped's no-stream path. */
function icsResponse(body: string, init: { status?: number; contentLength?: string } = {}) {
  const headers = new Map<string, string>();
  if (init.contentLength) headers.set("content-length", init.contentLength);
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    body: undefined,
    text: async () => body,
  };
}

const CAL = (...lines: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", ...lines, "END:VCALENDAR"].join("\r\n");

const EVENT = CAL(
  "BEGIN:VEVENT",
  "UID:a@test",
  "DTSTART:20260902T090000Z",
  "DTEND:20260902T100000Z",
  "SUMMARY:Board call",
  "END:VEVENT",
);

describe("fetchFeed", () => {
  it("refuses a private address without ever making a request", async () => {
    const r = await fetchFeed("http://169.254.169.254/latest/meta-data/", NOW);
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns a calendar into merged busy intervals", async () => {
    fetchMock.mockResolvedValue(icsResponse(EVENT));
    const r = await fetchFeed("https://cal.example.com/f.ics", NOW);
    expect(r.ok).toBe(true);
    expect(r.busy).toEqual([{ start: "2026-09-02T09:00:00.000Z", end: "2026-09-02T10:00:00.000Z" }]);
    expect(r.eventCount).toBe(1);
  });

  it("never follows a redirect — that is how a validated public URL becomes a private one", async () => {
    fetchMock.mockResolvedValue(icsResponse(EVENT));
    await fetchFeed("https://cal.example.com/f.ics", NOW);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });

  it("reports the upstream status rather than pretending the calendar is empty", async () => {
    fetchMock.mockResolvedValue(icsResponse("nope", { status: 404 }));
    const r = await fetchFeed("https://cal.example.com/f.ics", NOW);
    expect(r).toMatchObject({ ok: false, busy: [] });
    expect(r.error).toContain("404");
  });

  // The most common user error: pasting the calendar's web page instead of its
  // secret ICS link. That page returns 200 with HTML, so status alone is no help.
  it("rejects a sign-in page served with status 200", async () => {
    fetchMock.mockResolvedValue(icsResponse("<html><body>Sign in to continue</body></html>"));
    const r = await fetchFeed("https://cal.example.com/f.ics", NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/secret ICS link/i);
  });

  it("gives up on a calendar that declares an enormous body", async () => {
    fetchMock.mockResolvedValue(icsResponse(EVENT, { contentLength: String(50 * 1024 * 1024) }));
    const r = await fetchFeed("https://cal.example.com/f.ics", NOW);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/too large/i) });
  });

  it("says so plainly when the calendar service times out", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const r = await fetchFeed("https://cal.example.com/f.ics", NOW);
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/didn't respond in time/i) });
  });

  it("survives a network failure without throwing at the caller", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const r = await fetchFeed("https://cal.example.com/f.ics", NOW);
    expect(r).toMatchObject({ ok: false, busy: [] });
  });

  it("ignores events marked free — a transparent event blocks nothing", async () => {
    fetchMock.mockResolvedValue(
      icsResponse(
        CAL(
          "BEGIN:VEVENT",
          "UID:free@test",
          "DTSTART:20260902T090000Z",
          "DTEND:20260902T100000Z",
          "TRANSP:TRANSPARENT",
          "END:VEVENT",
        ),
      ),
    );
    const r = await fetchFeed("https://cal.example.com/f.ics", NOW);
    expect(r).toMatchObject({ ok: true, busy: [] });
  });

  it("leaves events outside the import window alone", async () => {
    fetchMock.mockResolvedValue(
      icsResponse(
        CAL("BEGIN:VEVENT", "UID:old@test", "DTSTART:20240101T090000Z", "DTEND:20240101T100000Z", "END:VEVENT"),
      ),
    );
    const r = await fetchFeed("https://cal.example.com/f.ics", NOW);
    expect(r).toMatchObject({ ok: true, busy: [] });
  });
});

/** A chainable Supabase stand-in that records what was asked of it. */
function fakeClient(result: { data?: unknown; error?: unknown } = { data: [], error: null }) {
  const calls: Array<{ table: string; op: string; payload?: unknown; filters: Array<[string, unknown]> }> = [];
  const rpc = jest.fn().mockResolvedValue({ error: null });
  const client = {
    calls,
    rpc,
    from(table: string) {
      const rec = { table, op: "select", payload: undefined as unknown, filters: [] as Array<[string, unknown]> };
      calls.push(rec);
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (p: unknown) => {
          rec.op = "update";
          rec.payload = p;
          return builder;
        },
        upsert: (p: unknown) => {
          rec.op = "upsert";
          rec.payload = p;
          return builder;
        },
        delete: () => {
          rec.op = "delete";
          return builder;
        },
        eq: (c: string, v: unknown) => {
          rec.filters.push([c, v]);
          return builder;
        },
        lt: (c: string, v: unknown) => {
          rec.filters.push([c, v]);
          return builder;
        },
        in: (c: string, v: unknown) => {
          rec.filters.push([c, v]);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve({ error: null, ...result }).then(res, rej),
      };
      return builder;
    },
  };
  return client;
}

describe("recordFeedResult", () => {
  it("stores the new busy set and clears the failure state on success", async () => {
    const client = fakeClient();
    await recordFeedResult(
      client as never,
      "feed-1",
      "user-1",
      { ok: true, busy: [{ start: "2026-09-02T09:00:00.000Z", end: "2026-09-02T10:00:00.000Z" }], events: [] },
      NOW,
    );
    const patch = client.calls[0].payload as Record<string, unknown>;
    expect(patch).toMatchObject({ last_error: null, consecutive_failures: 0, cached_at: NOW.toISOString() });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  // Yesterday's busy time is a far better guess than "suddenly free".
  it("leaves the previous cache in place when a fetch fails", async () => {
    const client = fakeClient();
    await recordFeedResult(client as never, "feed-1", "user-1", { ok: false, busy: [], events: [], error: "boom" }, NOW);
    const patch = client.calls[0].payload as Record<string, unknown>;
    expect(patch).not.toHaveProperty("cached_busy");
    expect(patch).toMatchObject({ last_error: "boom" });
  });

  it("counts a failure through the RPC so concurrent sweeps don't lose increments", async () => {
    const client = fakeClient();
    await recordFeedResult(client as never, "feed-1", "user-1", { ok: false, busy: [], events: [], error: "boom" }, NOW);
    expect(client.rpc).toHaveBeenCalledWith("increment_calendar_feed_failures", { feed_id: "feed-1" });
  });

  it("does not throw when the failure count cannot be written", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const client = fakeClient();
    client.rpc.mockRejectedValue(new Error("rpc down"));
    await expect(
      recordFeedResult(client as never, "feed-1", "user-1", { ok: false, busy: [], events: [], error: "boom" }, NOW),
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe("cachedBusyOf", () => {
  it("reads well-formed intervals", () => {
    expect(cachedBusyOf({ cached_busy: [{ start: "a", end: "b" }] })).toEqual([{ start: "a", end: "b" }]);
  });

  it("treats anything that isn't an array as no busy time", () => {
    expect(cachedBusyOf({ cached_busy: null })).toEqual([]);
    expect(cachedBusyOf({ cached_busy: "[]" })).toEqual([]);
  });

  it("skips malformed entries instead of throwing on them", () => {
    expect(cachedBusyOf({ cached_busy: [null, 7, { start: 1, end: 2 }, { start: "a", end: "b" }] })).toEqual([
      { start: "a", end: "b" },
    ]);
  });
});

describe("externalBusyForUser", () => {
  it("merges cached busy time across every connected calendar", async () => {
    const client = fakeClient({
      data: [
        { cached_busy: [{ start: "2026-09-02T09:00:00.000Z", end: "2026-09-02T10:00:00.000Z" }] },
        { cached_busy: [{ start: "2026-09-02T10:00:00.000Z", end: "2026-09-02T11:00:00.000Z" }] },
      ],
    });
    await expect(externalBusyForUser(client as never, "user-1")).resolves.toEqual([
      { start: "2026-09-02T09:00:00.000Z", end: "2026-09-02T11:00:00.000Z" },
    ]);
  });

  it("only reads the cache — availability must never wait on a third party", async () => {
    const client = fakeClient({ data: [] });
    await externalBusyForUser(client as never, "user-1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves to no busy time when the query fails, rather than breaking availability", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const client = fakeClient({ data: null, error: { message: "down" } });
    await expect(externalBusyForUser(client as never, "user-1")).resolves.toEqual([]);
    // Losing external busy time can permit a double-booking, so it is logged.
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("refreshStaleFeeds", () => {
  it("skips feeds whose cache is still warm", async () => {
    const client = fakeClient({
      data: [{ id: "f1", url: "https://cal.example.com/a.ics", cached_at: new Date(NOW.getTime() - 60_000).toISOString() }],
    });
    const summary = await refreshStaleFeeds(client as never, { now: NOW });
    expect(summary).toEqual({ refreshed: 0, failed: 0, skipped: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes a feed whose cache has aged out", async () => {
    fetchMock.mockResolvedValue(icsResponse(EVENT));
    const client = fakeClient({ data: [{ id: "f1", url: "https://cal.example.com/a.ics", cached_at: null }] });
    const summary = await refreshStaleFeeds(client as never, { now: NOW });
    expect(summary).toMatchObject({ refreshed: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches a warm feed when the owner asks for a sync now", async () => {
    fetchMock.mockResolvedValue(icsResponse(EVENT));
    const client = fakeClient({
      data: [{ id: "f1", url: "https://cal.example.com/a.ics", cached_at: NOW.toISOString() }],
    });
    const summary = await refreshStaleFeeds(client as never, { now: NOW, force: true });
    expect(summary).toMatchObject({ refreshed: 1, skipped: 0 });
  });

  it("counts a broken feed as failed and carries on", async () => {
    fetchMock.mockResolvedValue(icsResponse("nope", { status: 500 }));
    const client = fakeClient({ data: [{ id: "f1", url: "https://cal.example.com/a.ics", cached_at: null }] });
    await expect(refreshStaleFeeds(client as never, { now: NOW })).resolves.toMatchObject({ refreshed: 0, failed: 1 });
  });

  it("returns an empty summary rather than throwing when the query fails", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const client = fakeClient({ data: null, error: { message: "down" } });
    await expect(refreshStaleFeeds(client as never, { now: NOW })).resolves.toEqual({
      refreshed: 0,
      failed: 0,
      skipped: 0,
    });
    spy.mockRestore();
  });
});

// The display half of a feed fetch. Before this existed, a subscribed calendar
// could make a member unavailable while drawing nothing on the grid — the
// events were parsed in full and then discarded into anonymous intervals.
describe("applyFeedEvents", () => {
  const event = (over: Partial<IcsEvent> = {}): IcsEvent => ({
    uid: "evt-1",
    summary: "Board meeting",
    startIso: "2026-09-02T09:00:00.000Z",
    endIso: "2026-09-02T10:00:00.000Z",
    allDay: false,
    transparent: false,
    status: "CONFIRMED",
    location: "London",
    description: "Private notes nobody here needs",
    ...over,
  });

  it("stores each event with the detail a grid draws", async () => {
    const client = fakeClient();
    const summary = await applyFeedEvents(client as never, "feed-1", "user-1", [event()], NOW);

    expect(summary.upserted).toBe(1);
    const upsert = client.calls.find((c) => c.op === "upsert")!;
    expect(upsert.table).toBe("calendar_feed_events");
    expect((upsert.payload as Array<Record<string, unknown>>)[0]).toMatchObject({
      feed_id: "feed-1",
      user_id: "user-1",
      uid: "evt-1",
      summary: "Board meeting",
      location: "London",
      transparent: false,
      updated_at: NOW.toISOString(),
    });
  });

  // The one field worth NOT keeping a copy of: the grid never draws it, and it
  // is where someone's private notes live.
  it("does not store the description", async () => {
    const client = fakeClient();
    await applyFeedEvents(client as never, "feed-1", "user-1", [event()], NOW);
    const row = (client.calls.find((c) => c.op === "upsert")!.payload as Array<Record<string, unknown>>)[0];
    expect(row).not.toHaveProperty("description");
  });

  // Every instance of a recurring series carries its parent's UID, so the UID
  // alone cannot be the key — collapsing them would leave one event a week.
  it("keeps recurring instances apart by start time", async () => {
    const client = fakeClient();
    const summary = await applyFeedEvents(
      client as never,
      "feed-1",
      "user-1",
      [
        event({ startIso: "2026-09-02T09:00:00.000Z" }),
        event({ startIso: "2026-09-09T09:00:00.000Z" }),
        event({ startIso: "2026-09-16T09:00:00.000Z" }),
      ],
      NOW,
    );
    expect(summary.upserted).toBe(3);
  });

  // A malformed feed repeating the same uid+start would make Postgres reject
  // the whole batch for touching one row twice, losing every other event.
  it("drops a duplicate uid+start rather than failing the batch", async () => {
    const client = fakeClient();
    const summary = await applyFeedEvents(client as never, "feed-1", "user-1", [event(), event()], NOW);
    expect(summary.upserted).toBe(1);
  });

  // Upsert-then-prune, not delete-then-insert: a feed refreshes every half hour
  // and must never blink empty for whoever is looking at the calendar.
  it("prunes only rows this run did not touch", async () => {
    const client = fakeClient();
    await applyFeedEvents(client as never, "feed-1", "user-1", [event()], NOW);

    const ops = client.calls.filter((c) => c.op === "upsert" || c.op === "delete").map((c) => c.op);
    expect(ops).toEqual(["upsert", "delete"]);

    const prune = client.calls.find((c) => c.op === "delete")!;
    expect(prune.filters).toContainEqual(["feed_id", "feed-1"]);
    expect(prune.filters).toContainEqual(["updated_at", NOW.toISOString()]);
  });

  // If the write failed, nothing carries this run's stamp — pruning would then
  // delete a perfectly good previous fetch and leave the member with nothing.
  it("does not prune when the upsert failed", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const client = fakeClient({ error: { message: "upsert boom" } });
    const summary = await applyFeedEvents(client as never, "feed-1", "user-1", [event()], NOW);

    expect(summary.upserted).toBe(0);
    expect(client.calls.some((c) => c.op === "delete")).toBe(false);
    spy.mockRestore();
  });
});

// A failed fetch must not empty the calendar, for the same reason it does not
// clear cached_busy: a bad minute at the feed's host is not "you are free".
describe("recordFeedResult — events", () => {
  it("writes events on success", async () => {
    const client = fakeClient();
    await recordFeedResult(
      client as never,
      "feed-1",
      "user-1",
      {
        ok: true,
        busy: [],
        events: [
          {
            uid: "e1",
            summary: "Standup",
            startIso: "2026-09-02T09:00:00.000Z",
            endIso: "2026-09-02T09:15:00.000Z",
            allDay: false,
            transparent: false,
            status: null,
            location: null,
            description: null,
          },
        ],
      },
      NOW,
    );
    expect(client.calls.some((c) => c.table === "calendar_feed_events" && c.op === "upsert")).toBe(true);
  });

  it("leaves stored events alone when the fetch failed", async () => {
    const client = fakeClient();
    await recordFeedResult(client as never, "feed-1", "user-1", { ok: false, busy: [], events: [], error: "boom" }, NOW);
    expect(client.calls.some((c) => c.table === "calendar_feed_events")).toBe(false);
  });
});
