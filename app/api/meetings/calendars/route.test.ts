// The calendar rail's data. Two stores behind one list, which is where the
// interesting failures are: a member's Google events must not disappear because
// the feed table is unavailable, and a hidden calendar's contents must not
// reach the client at all.
const authMock = jest.fn();
const from = jest.fn();

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({ createServerClient: () => ({ from }) }));
jest.mock("@/lib/calendar/google", () => ({ connectionHealth: () => ({ state: "ok", message: null }) }));
jest.mock("@/lib/calendar/feeds", () => ({ feedHealth: () => ({ state: "ok", message: null }) }));
jest.mock("@/lib/google-oauth", () => ({ googleOAuthConfigured: () => true }));

import { NextRequest } from "next/server";
import { GET } from "./route";

const WINDOW = "from=2026-09-01T00:00:00.000Z&to=2026-09-30T00:00:00.000Z";
const req = (qs = WINDOW) => new NextRequest(`https://x.test/api/meetings/calendars?${qs}`);

const GOOGLE_CAL = {
  id: "cal-1",
  summary: "Work",
  background_color: "#123456",
  is_visible: true,
  blocks_availability: true,
  is_primary: true,
  access_role: "owner",
};
const FEED = {
  id: "feed-1",
  label: "Family",
  is_active: true,
  last_success_at: null,
  last_error: null,
  consecutive_failures: 0,
};
const GOOGLE_EVENT = {
  id: "ge-1",
  calendar_id: "cal-1",
  summary: "Board meeting",
  location: "London",
  html_link: "https://cal.google/ge-1",
  starts_at: "2026-09-02T10:00:00.000Z",
  ends_at: "2026-09-02T11:00:00.000Z",
  is_all_day: false,
  status: "confirmed",
  transparency: "opaque",
};
const FEED_EVENT = {
  id: "fe-1",
  feed_id: "feed-1",
  summary: "School run",
  location: null,
  starts_at: "2026-09-02T08:00:00.000Z",
  ends_at: "2026-09-02T08:30:00.000Z",
  is_all_day: false,
  status: "CONFIRMED",
  transparent: false,
};

/**
 * Table-aware stub.
 *
 * The two query shapes end differently: layer queries finish on `order` (twice,
 * for google_calendars) and are awaited directly, while event queries finish on
 * `limit`. So the builder is itself thenable — resolving to the layer rows —
 * and `limit` resolves to the event rows.
 *
 * `calls` records which tables were touched, which is how the hidden-calendar
 * case is asserted: the point is that nothing was fetched, not merely that
 * nothing was rendered.
 */
function client(opts: {
  calendars?: unknown[];
  feeds?: unknown[];
  googleEvents?: { data?: unknown[] | null; error?: unknown };
  feedEvents?: { data?: unknown[] | null; error?: unknown };
  calls?: string[];
} = {}) {
  return (table: string) => {
    opts.calls?.push(table);

    const layerRows = () => {
      if (table === "google_calendars") return { data: opts.calendars ?? [], error: null };
      if (table === "calendar_feeds") return { data: opts.feeds ?? [], error: null };
      return { data: [], error: null };
    };
    const eventRows = () =>
      table === "external_events" ? opts.googleEvents ?? { data: [] } : opts.feedEvents ?? { data: [] };

    const b: Record<string, unknown> = {};
    for (const k of ["select", "eq", "in", "lt", "gt", "order"]) b[k] = () => b;
    b.limit = async () => eventRows();
    b.maybeSingle = async () =>
      table === "google_calendar_connections"
        ? { data: { google_email: "rae@x.test", last_sync_at: null, last_error: null, consecutive_failures: 0 } }
        : { data: null };
    b.then = (resolve: (v: unknown) => unknown) => resolve(layerRows());
    return b;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "u1", role: "owner", email: "u@test" } });
});

describe("GET /api/meetings/calendars", () => {
  it("returns both sources as one list, ordered by start", async () => {
    from.mockImplementation(
      client({
        calendars: [GOOGLE_CAL],
        feeds: [FEED],
        googleEvents: { data: [GOOGLE_EVENT] },
        feedEvents: { data: [FEED_EVENT] },
      }),
    );
    const json = await (await GET(req())).json();

    expect(json.layers).toHaveLength(2);
    // The feed event starts earlier, so it sorts first even though the Google
    // query ran first — the grid lays out lanes off this order.
    expect(json.events.map((e: { title: string }) => e.title)).toEqual(["School run", "Board meeting"]);
    // A feed event is keyed by its layer's id, which is how the client colours
    // it and how the layer checkbox hides it.
    expect(json.events[0]).toMatchObject({ calendarId: "feed-1", isBusy: true, link: null });
    expect(json.events[1]).toMatchObject({ calendarId: "cal-1", link: "https://cal.google/ge-1" });
  });

  // The deploy window: migrations apply on push to main in parallel with the
  // deploy, so the code can be live seconds before calendar_feed_events exists.
  // Losing feed events there is expected. Losing the whole rail is not.
  it("still returns Google events when the feed table is unavailable", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    from.mockImplementation(
      client({
        calendars: [GOOGLE_CAL],
        feeds: [FEED],
        googleEvents: { data: [GOOGLE_EVENT] },
        feedEvents: { data: null, error: { message: 'relation "calendar_feed_events" does not exist' } },
      }),
    );
    const res = await GET(req());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.layers).toHaveLength(2);
    expect(json.events).toHaveLength(1);
    expect(json.events[0].title).toBe("Board meeting");
    // And it says so, rather than rendering an empty calendar in silence —
    // both in the logs and to the member, who is the one at risk of reading an
    // empty grid as a free day.
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("ics events unavailable"), expect.any(String));
    expect(json.unavailable).toEqual(["ics"]);
    spy.mockRestore();
  });

  it("survives the Google side failing too, without losing feed events", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    from.mockImplementation(
      client({
        calendars: [GOOGLE_CAL],
        feeds: [FEED],
        googleEvents: { data: null, error: { message: "boom" } },
        feedEvents: { data: [FEED_EVENT] },
      }),
    );
    const json = await (await GET(req())).json();
    expect(json.events).toHaveLength(1);
    expect(json.events[0].title).toBe("School run");
    expect(json.unavailable).toEqual(["google"]);
    spy.mockRestore();
  });

  // The checkbox hides the data, not just the pixels.
  it("never queries events for a calendar the member has hidden", async () => {
    const calls: string[] = [];
    from.mockImplementation(
      client({
        calls,
        calendars: [{ ...GOOGLE_CAL, is_visible: false }],
        feeds: [{ ...FEED, is_active: false }],
      }),
    );
    const json = await (await GET(req())).json();

    expect(json.events).toEqual([]);
    expect(calls).not.toContain("external_events");
    expect(calls).not.toContain("calendar_feed_events");
    // Nothing failed — a hidden calendar is a choice, not an outage.
    expect(json.unavailable).toEqual([]);
  });

  it("drops a cancelled feed event, whatever case the feed spells it in", async () => {
    from.mockImplementation(
      client({
        feeds: [FEED],
        feedEvents: { data: [{ ...FEED_EVENT, status: "cancelled" }, { ...FEED_EVENT, id: "fe-2", status: "CANCELLED" }] },
      }),
    );
    expect((await (await GET(req())).json()).events).toEqual([]);
  });

  // RFC 5545 TRANSP — shown on the grid, but it does not read as busy.
  it("reports a transparent feed event as not busy", async () => {
    from.mockImplementation(
      client({ feeds: [FEED], feedEvents: { data: [{ ...FEED_EVENT, transparent: true }] } }),
    );
    const json = await (await GET(req())).json();
    expect(json.events[0].isBusy).toBe(false);
  });

  it("refuses a window it cannot serve", async () => {
    from.mockImplementation(client());
    expect((await GET(req("from=2026-09-01T00:00:00Z"))).status).toBe(422);
    expect((await GET(req("from=2026-09-02T00:00:00Z&to=2026-09-01T00:00:00Z"))).status).toBe(422);
  });

  it("requires an org context", async () => {
    authMock.mockResolvedValue({ ok: false, error: "Unauthorized", status: 401 });
    expect((await GET(req())).status).toBe(401);
  });
});
