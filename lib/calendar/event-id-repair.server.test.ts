// lib/calendar/event-id-repair.server.test.ts
// The sweep that reattaches event ids.
//
// The assertion that matters most here is a NEGATIVE one: this must never write
// to a calendar. Every write in google-write.server.ts carries
// `sendUpdates: "all"`, so a repair that re-pushed would email every attendee of
// every affected meeting about a change none of them made. The events are
// already correct; only the rows are missing ids. So the sweep reads.
const accessTokenForMock = jest.fn();

jest.mock("@/lib/calendar/google.server", () => ({
  accessTokenFor: (...a: unknown[]) => accessTokenForMock(...a),
}));

import { runEventIdRepair } from "./event-id-repair.server";

const fetchMock = jest.fn();

function respond(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

interface Row {
  id: string;
  host_id: string | null;
  external_calendar_sync_enabled: boolean | null;
  external_calendar_event_id: string | null;
  deleted_at: string | null;
  is_draft: boolean | null;
}

const row = (over: Partial<Row> = {}): Row => ({
  id: "mtg-1",
  host_id: "host-1",
  external_calendar_sync_enabled: true,
  external_calendar_event_id: null,
  deleted_at: null,
  is_draft: false,
  ...over,
});

interface Recorded {
  updates: Array<{ id: string; payload: Record<string, unknown> }>;
}

/**
 * A Supabase stand-in: serves the meeting list, the connection and the calendar,
 * and records every live_meetings update so the assertions can read them.
 */
function client(
  opts: {
    meetings?: Row[];
    listError?: string;
    conn?: unknown;
    calendar?: unknown;
    updateError?: string;
  } = {},
  recorded: Recorded = { updates: [] },
) {
  const conn = "conn" in opts ? opts.conn : { id: "c1", user_id: "host-1" };
  const calendar =
    "calendar" in opts
      ? opts.calendar
      : { google_calendar_id: "primary@example.com", access_role: "owner", is_primary: true };

  const api = {
    from(table: string) {
      if (table === "google_calendar_connections") {
        return chainTo({ maybeSingle: async () => ({ data: conn }) });
      }
      if (table === "google_calendars") {
        return chainTo({ maybeSingle: async () => ({ data: calendar }) });
      }
      // live_meetings: the select resolves to the list; the update is captured.
      let filterId = "";
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          if (col === "id") filterId = String(val);
          return chain;
        },
        is: () => chain,
        not: () => chain,
        order: () => chain,
        limit: async () =>
          opts.listError
            ? { data: null, error: { message: opts.listError } }
            : { data: opts.meetings ?? [], error: null },
        update: (payload: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            recorded.updates.push({ id: id ?? filterId, payload });
            return opts.updateError ? { error: { message: opts.updateError } } : { error: null };
          },
        }),
      };
      return chain;
    },
  };
  return { api, recorded };
}

function chainTo(terminal: { maybeSingle: () => Promise<{ data: unknown }> }) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    ...terminal,
  };
  return chain;
}

/** Every fetch this sweep is allowed to make is a GET. */
function writesAttempted() {
  return fetchMock.mock.calls.filter(([, init]) => {
    const method = (init as { method?: string } | undefined)?.method ?? "GET";
    return method !== "GET";
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  accessTokenForMock.mockResolvedValue({ ok: true, data: "access-token" });
  fetchMock.mockResolvedValue(respond(200, { items: [] }));
});

describe("runEventIdRepair", () => {
  it("records the id of the event it finds", async () => {
    fetchMock.mockResolvedValue(respond(200, { items: [{ id: "evt-found", status: "confirmed" }] }));
    const { api, recorded } = client({ meetings: [row()] });

    const stats = await runEventIdRepair(api as never);

    expect(stats).toMatchObject({ examined: 1, reattached: 1, noEvent: 0, failed: 0 });
    expect(recorded.updates).toHaveLength(1);
    expect(recorded.updates[0].payload).toMatchObject({
      external_calendar_event_id: "evt-found",
      external_calendar_sync_status: "synced",
      external_calendar_last_error: null,
    });
  });

  it("NEVER writes to the calendar", async () => {
    // The whole design. A re-push would notify every attendee via
    // sendUpdates:"all"; the event is already right, so the sweep only looks.
    fetchMock.mockResolvedValue(respond(200, { items: [{ id: "evt-found", status: "confirmed" }] }));
    const { api } = client({ meetings: [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })] });

    await runEventIdRepair(api as never);

    expect(fetchMock).toHaveBeenCalled();
    expect(writesAttempted()).toEqual([]);
  });

  it("looks the event up by the meeting's own marker", async () => {
    fetchMock.mockResolvedValue(respond(200, { items: [{ id: "evt-1", status: "confirmed" }] }));
    const { api } = client({ meetings: [row({ id: "mtg-xyz" })] });

    await runEventIdRepair(api as never);

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("privateExtendedProperty");
    expect(String(url)).toContain("mtg-xyz");
  });

  it("leaves a meeting with no event alone rather than creating one", async () => {
    // Creating one would also notify, so it is a person's decision.
    fetchMock.mockResolvedValue(respond(200, { items: [] }));
    const { api, recorded } = client({ meetings: [row()] });

    const stats = await runEventIdRepair(api as never);

    expect(stats).toMatchObject({ examined: 1, reattached: 0, noEvent: 1 });
    expect(recorded.updates).toEqual([]);
    expect(writesAttempted()).toEqual([]);
  });

  it("counts a host with no connected calendar without failing them", async () => {
    // Not a failure and not something a retry fixes — but the rows stay
    // eligible, so reconnecting heals them on a later sweep.
    const { api, recorded } = client({ meetings: [row(), row({ id: "mtg-2" })], conn: null });

    const stats = await runEventIdRepair(api as never);

    expect(stats).toMatchObject({ examined: 2, noCalendar: 2, failed: 0, reattached: 0 });
    expect(recorded.updates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts a host whose token will not refresh as a failure, not a dead end", async () => {
    accessTokenForMock.mockResolvedValue({ ok: false, error: "invalid_grant" });
    const { api } = client({ meetings: [row()] });

    const stats = await runEventIdRepair(api as never);

    expect(stats).toMatchObject({ examined: 1, failed: 1, noCalendar: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats an ok result carrying no token as no token", async () => {
    // `ok` and `data` are separate fields on GoogleCallResult, so the flag alone
    // would have handed `undefined` to every lookup.
    accessTokenForMock.mockResolvedValue({ ok: true });
    const { api } = client({ meetings: [row()] });

    const stats = await runEventIdRepair(api as never);

    expect(stats).toMatchObject({ examined: 1, failed: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for one connection per host, not per meeting", async () => {
    fetchMock.mockResolvedValue(respond(200, { items: [{ id: "evt", status: "confirmed" }] }));
    const { api } = client({
      meetings: [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })],
    });

    await runEventIdRepair(api as never);

    // One token mint for three meetings that share a host.
    expect(accessTokenForMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("carries on when one meeting's lookup throws", async () => {
    // A sweep that dies partway leaves the rest of a backlog untouched.
    fetchMock
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(respond(200, { items: [{ id: "evt-2", status: "confirmed" }] }));
    const { api, recorded } = client({ meetings: [row({ id: "a" }), row({ id: "b" })] });

    const stats = await runEventIdRepair(api as never);

    expect(stats).toMatchObject({ examined: 2, failed: 1, reattached: 1 });
    expect(recorded.updates.map((u) => u.id)).toEqual(["b"]);
  });

  it("counts a recording write that was rejected as a failure", async () => {
    fetchMock.mockResolvedValue(respond(200, { items: [{ id: "evt", status: "confirmed" }] }));
    const { api } = client({ meetings: [row()], updateError: "row level security" });

    const stats = await runEventIdRepair(api as never);

    expect(stats).toMatchObject({ examined: 1, failed: 1, reattached: 0 });
  });

  it("reports nothing and touches nothing when the list cannot be read", async () => {
    const { api, recorded } = client({ listError: "timeout" });

    const stats = await runEventIdRepair(api as never);

    expect(stats).toMatchObject({ examined: 0, more: false });
    expect(recorded.updates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says a backlog remains, and does not repair past the bound", async () => {
    // It asks for one more than the limit purely to learn this, so the extra row
    // must not be worked.
    fetchMock.mockResolvedValue(respond(200, { items: [{ id: "evt", status: "confirmed" }] }));
    const meetings = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
    const { api, recorded } = client({ meetings });

    const stats = await runEventIdRepair(api as never, 2);

    expect(stats).toMatchObject({ examined: 2, reattached: 2, more: true });
    expect(recorded.updates.map((u) => u.id)).toEqual(["a", "b"]);
  });

  it("does not claim a backlog when the last page fits exactly", async () => {
    fetchMock.mockResolvedValue(respond(200, { items: [{ id: "evt", status: "confirmed" }] }));
    const { api } = client({ meetings: [row({ id: "a" }), row({ id: "b" })] });

    const stats = await runEventIdRepair(api as never, 2);

    expect(stats).toMatchObject({ examined: 2, more: false });
  });

  it("is quiet when there is nothing to repair", async () => {
    const { api, recorded } = client({ meetings: [] });

    const stats = await runEventIdRepair(api as never);

    expect(stats).toMatchObject({ examined: 0, reattached: 0, more: false });
    expect(recorded.updates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
