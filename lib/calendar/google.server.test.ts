// lib/calendar/google.server.test.ts
// These run inside a cron sweep, where an exception abandons every remaining
// member's calendar. So the cases that matter are the failures.
const refreshAccessTokenMock = jest.fn();
const encryptSecretMock = jest.fn();
const decryptSecretMock = jest.fn();

jest.mock("@/lib/google-oauth", () => ({
  refreshAccessToken: (...a: unknown[]) => refreshAccessTokenMock(...a),
}));
jest.mock("@/lib/vault", () => ({
  encryptSecret: (...a: unknown[]) => encryptSecretMock(...a),
  decryptSecret: (...a: unknown[]) => decryptSecretMock(...a),
}));

import {
  accessTokenFor,
  applyEvents,
  listCalendars,
  listEvents,
  openRefreshToken,
  sealRefreshToken,
  syncConnection,
} from "./google.server";

const fetchMock = jest.fn();
const NOW = new Date("2026-09-01T12:00:00.000Z");

const CONN = {
  id: "conn-1",
  user_id: "user-1",
  organization_id: "org-1",
  google_email: "rae@example.com",
  refresh_ciphertext: "ct",
  refresh_iv: "iv",
  refresh_auth_tag: "tag",
  last_sync_at: null,
  last_error: null,
  consecutive_failures: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  encryptSecretMock.mockReturnValue({ ciphertext: "ct", iv: "iv", authTag: "tag" });
  decryptSecretMock.mockReturnValue("refresh-token");
  refreshAccessTokenMock.mockResolvedValue({ accessToken: "at", expiresInSec: 3600 });
});

function json(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("refresh token sealing", () => {
  it("splits a token into the three parts GCM needs", () => {
    expect(sealRefreshToken("secret")).toEqual({
      refresh_ciphertext: "ct",
      refresh_iv: "iv",
      refresh_auth_tag: "tag",
    });
  });

  it("recovers a stored token", () => {
    expect(openRefreshToken(CONN)).toBe("refresh-token");
    expect(decryptSecretMock).toHaveBeenCalledWith({ ciphertext: "ct", iv: "iv", authTag: "tag" });
  });
});

describe("accessTokenFor", () => {
  it("mints a short-lived token from the stored grant", async () => {
    await expect(accessTokenFor(CONN)).resolves.toEqual({ ok: true, data: "at" });
  });

  // Google says invalid_grant when a member revokes access or changes their
  // password. That word has to survive, because connectionHealth matches on it
  // to say "reconnect" rather than "wait".
  it("preserves the invalid_grant marker when Google revokes the grant", async () => {
    refreshAccessTokenMock.mockRejectedValue(new Error("invalid_grant: Token has been expired or revoked."));
    const r = await accessTokenFor(CONN);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid_grant/);
  });

  it("does not throw when the vault key no longer decrypts the token", async () => {
    decryptSecretMock.mockImplementation(() => {
      throw new Error("Unsupported state or unable to authenticate data");
    });
    const r = await accessTokenFor(CONN);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe("listCalendars", () => {
  it("follows pagination to the end", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ items: [{ id: "a" }], nextPageToken: "p2" }))
      .mockResolvedValueOnce(json({ items: [{ id: "b" }] }));
    const r = await listCalendars("at");
    expect(r.ok).toBe(true);
    expect(r.data?.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("reports a refusal instead of throwing", async () => {
    fetchMock.mockResolvedValue(json({ error: "forbidden" }, 403));
    const r = await listCalendars("at");
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toBeTruthy();
  });

  it("survives a network failure", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    await expect(listCalendars("at")).resolves.toMatchObject({ ok: false });
  });
});

describe("listEvents", () => {
  it("sends a time window on a first sync, and no sync token", async () => {
    fetchMock.mockResolvedValue(json({ items: [], nextSyncToken: "tok1" }));
    await listEvents("at", "cal@group.calendar.google.com", null, NOW);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("timeMin")).toBeTruthy();
    expect(url.searchParams.get("syncToken")).toBeNull();
    // Without this the grid would have to expand RRULE itself.
    expect(url.searchParams.get("singleEvents")).toBe("true");
  });

  // Google rejects a request carrying both — the token already encodes what the
  // caller has seen.
  it("sends a sync token on an incremental sync, and no time window", async () => {
    fetchMock.mockResolvedValue(json({ items: [], nextSyncToken: "tok2" }));
    await listEvents("at", "cal", "tok1", NOW);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("syncToken")).toBe("tok1");
    expect(url.searchParams.get("timeMin")).toBeNull();
    expect(url.searchParams.get("timeMax")).toBeNull();
  });

  it("escapes a calendar id so one containing a slash cannot alter the path", async () => {
    fetchMock.mockResolvedValue(json({ items: [] }));
    await listEvents("at", "a/../../hijack", null, NOW);
    expect(String(fetchMock.mock.calls[0][0])).toContain("a%2F..%2F..%2Fhijack");
  });

  // A 410 is routine: the cursor aged out. The caller drops it and resyncs.
  it("flags an aged-out cursor distinctly from other failures", async () => {
    fetchMock.mockResolvedValue(json({}, 410));
    const r = await listEvents("at", "cal", "stale-token", NOW);
    expect(r).toMatchObject({ ok: false, tokenExpired: true });
  });

  it("carries the next cursor back for the caller to store", async () => {
    fetchMock.mockResolvedValue(json({ items: [{ id: "e1" }], nextSyncToken: "tok9" }));
    const r = await listEvents("at", "cal", null, NOW);
    expect(r.data?.nextSyncToken).toBe("tok9");
  });
});

/** A chainable Supabase stand-in that records what it was asked to do. */
function fakeClient() {
  const calls: Array<{ table: string; op: string; payload?: unknown }> = [];
  const client = {
    calls,
    from(table: string) {
      const rec = { table, op: "select", payload: undefined as unknown };
      calls.push(rec);
      const b: Record<string, unknown> = {
        select: () => b,
        upsert: (p: unknown) => {
          rec.op = "upsert";
          rec.payload = p;
          return b;
        },
        update: (p: unknown) => {
          rec.op = "update";
          rec.payload = p;
          return b;
        },
        delete: () => {
          rec.op = "delete";
          return b;
        },
        eq: () => b,
        in: (_c: string, v: unknown) => {
          rec.payload = v;
          return b;
        },
        order: () => b,
        limit: () => b,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(res, rej),
      };
      return b;
    },
  };
  return client;
}

describe("applyEvents", () => {
  const timed = (id: string) => ({
    id,
    start: { dateTime: "2026-09-01T09:00:00Z" },
    end: { dateTime: "2026-09-01T10:00:00Z" },
  });

  it("stores usable events", async () => {
    const client = fakeClient();
    const s = await applyEvents(client as never, "cal-row", "user-1", [timed("e1"), timed("e2")]);
    expect(s.upserted).toBe(2);
    expect(client.calls.find((c) => c.op === "upsert")?.table).toBe("external_events");
  });

  // Incremental sync reports a deletion by re-sending the event as cancelled.
  // Storing one is how a cancelled meeting lives on someone's calendar forever.
  it("deletes tombstones rather than storing them", async () => {
    const client = fakeClient();
    const s = await applyEvents(client as never, "cal-row", "user-1", [
      { id: "gone", status: "cancelled" },
      timed("e1"),
    ]);
    expect(s.deleted).toBe(1);
    expect(s.upserted).toBe(1);
    const del = client.calls.find((c) => c.op === "delete");
    expect(del?.payload).toEqual(["gone"]);
  });

  it("counts unusable events as skipped instead of guessing a time", async () => {
    const client = fakeClient();
    const s = await applyEvents(client as never, "cal-row", "user-1", [
      { id: "no-times" },
      { id: "bad", start: { dateTime: "nonsense" }, end: { dateTime: "2026-09-01T10:00:00Z" } },
    ]);
    expect(s).toMatchObject({ upserted: 0, skipped: 2 });
  });

  it("does nothing, and does not throw, on an empty page", async () => {
    const client = fakeClient();
    await expect(applyEvents(client as never, "cal-row", "user-1", [])).resolves.toEqual({
      upserted: 0,
      deleted: 0,
      skipped: 0,
    });
  });

  // A first sync of a busy calendar can carry thousands of events; one
  // oversized statement is how a sync dies at the last row.
  it("chunks a large page rather than sending one enormous statement", async () => {
    const client = fakeClient();
    const many = Array.from({ length: 1200 }, (_, i) => timed(`e${i}`));
    const s = await applyEvents(client as never, "cal-row", "user-1", many);
    expect(s.upserted).toBe(1200);
    expect(client.calls.filter((c) => c.op === "upsert")).toHaveLength(3);
  });
});

describe("applyEvents — echoes of our own writes", () => {
  /**
   * @param owned  what live_meetings says: meetingId -> external_calendar_event_id
   */
  function clientWith(owned: Record<string, string | null>, upserts: unknown[][]) {
    return {
      from: (table: string) => {
        if (table === "live_meetings") {
          return {
            select: () => ({
              in: async (_col: string, ids: string[]) => ({
                data: ids.filter((id) => id in owned).map((id) => ({ id, external_calendar_event_id: owned[id] })),
                error: null,
              }),
            }),
          };
        }
        return {
          delete: () => ({ eq: () => ({ in: async () => ({ error: null }) }) }),
          upsert: async (rows: unknown[]) => {
            upserts.push(rows);
            return { error: null };
          },
        };
      },
    } as never;
  }

  const ourEvent = {
    id: "ours",
    status: "confirmed",
    summary: "Q3 LP update",
    start: { dateTime: "2026-09-01T15:00:00Z" },
    end: { dateTime: "2026-09-01T16:00:00Z" },
    extendedProperties: { private: { fundexecsMeetingId: "mtg-1" } },
  };

  const theirEvent = {
    id: "theirs",
    status: "confirmed",
    summary: "Dentist",
    start: { dateTime: "2026-09-01T09:00:00Z" },
    end: { dateTime: "2026-09-01T10:00:00Z" },
  };

  function stored(upserts: unknown[][]): string[] {
    return (upserts.flat() as Array<{ google_event_id: string }>).map((r) => r.google_event_id);
  }

  it("does not store an event this app pushed", async () => {
    // Without this, every FundExecs meeting synced to Google returns as a
    // second, "external" copy of itself — and that copy blocks the very time
    // the meeting already occupies.
    const upserts: unknown[][] = [];
    const summary = await applyEvents(clientWith({ "mtg-1": "ours" }, upserts), "cal-1", "user-1", [
      ourEvent,
      theirEvent,
    ]);

    expect(summary.skipped).toBe(1);
    expect(summary.upserted).toBe(1);
    expect(stored(upserts)).toEqual(["theirs"]);
  });

  it("stores a foreign event that merely carries our marker", async () => {
    // extendedProperties.private is writable by any integration with access to
    // the calendar. Trusting the marker alone would let another app hide busy
    // time from availability and invite a double-booking.
    const upserts: unknown[][] = [];
    const impostor = { ...theirEvent, extendedProperties: { private: { fundexecsMeetingId: "mtg-1" } } };

    const summary = await applyEvents(clientWith({ "mtg-1": "ours" }, upserts), "cal-1", "user-1", [impostor]);

    expect(summary.skipped).toBe(0);
    expect(stored(upserts)).toEqual(["theirs"]);
  });

  it("stores a marked event naming a meeting that was never synced", async () => {
    const upserts: unknown[][] = [];
    const summary = await applyEvents(clientWith({ "mtg-1": null }, upserts), "cal-1", "user-1", [ourEvent]);

    expect(summary.skipped).toBe(0);
    expect(stored(upserts)).toEqual(["ours"]);
  });

  it("stores a marked event naming a meeting that does not exist", async () => {
    const upserts: unknown[][] = [];
    const summary = await applyEvents(clientWith({}, upserts), "cal-1", "user-1", [ourEvent]);

    expect(summary.skipped).toBe(0);
    expect(stored(upserts)).toEqual(["ours"]);
  });

  it("keeps busy time when ownership cannot be confirmed at all", async () => {
    // A failed lookup must not hide anything: a duplicate is cosmetic, a
    // hidden meeting is a double-booking.
    const upserts: unknown[][] = [];
    const brokenClient = {
      from: (table: string) => {
        if (table === "live_meetings") {
          return { select: () => ({ in: async () => ({ data: null, error: { message: "boom" } }) }) };
        }
        return {
          delete: () => ({ eq: () => ({ in: async () => ({ error: null }) }) }),
          upsert: async (rows: unknown[]) => {
            upserts.push(rows);
            return { error: null };
          },
        };
      },
    } as never;

    const summary = await applyEvents(brokenClient, "cal-1", "user-1", [ourEvent]);

    expect(summary.skipped).toBe(0);
    expect(stored(upserts)).toEqual(["ours"]);
  });
});

// The first sync now runs inside the OAuth callback, where a member is waiting
// on the response. These cover the budget that keeps that request bounded —
// and, just as importantly, what the budget must NOT do to the data.
describe("syncConnection — time budget", () => {
  const CALENDARS = [
    { id: "cal-1", google_calendar_id: "a@group.calendar.google.com", sync_token: null },
    { id: "cal-2", google_calendar_id: "b@group.calendar.google.com", sync_token: null },
    { id: "cal-3", google_calendar_id: "c@group.calendar.google.com", sync_token: null },
  ];

  /** Records every table write so the assertions can read what actually happened. */
  function budgetClient(updates: Array<{ table: string; patch: Record<string, unknown> }>) {
    return {
      from: (table: string) => ({
        select: () => ({
          eq: async () => ({ data: table === "google_calendars" ? CALENDARS : [], error: null }),
          in: async () => ({ data: [], error: null }),
        }),
        upsert: async () => ({ error: null }),
        delete: () => ({ eq: () => ({ in: async () => ({ error: null }) }) }),
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            updates.push({ table, patch });
            return { error: null };
          },
        }),
      }),
      rpc: async () => ({ error: null }),
    } as never;
  }

  beforeEach(() => {
    jest.restoreAllMocks();
    decryptSecretMock.mockReturnValue("refresh-token");
    refreshAccessTokenMock.mockResolvedValue({ accessToken: "at", expiresIn: 3600 });
    global.fetch = fetchMock as never;
    fetchMock.mockReset();
  });

  /** Every Google call succeeds, but each one burns `costMs` of the budget. */
  function respondSlowly(costMs: number) {
    let clock = Date.now();
    jest.spyOn(Date, "now").mockImplementation(() => clock);
    fetchMock.mockImplementation(async () => {
      clock += costMs;
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [], nextSyncToken: "tok" }),
      };
    });
  }

  it("stops between calendars once the budget is spent", async () => {
    respondSlowly(400);
    const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
    // 1000ms buys the calendar-list call plus roughly one calendar's events.
    const summary = await syncConnection(budgetClient(updates), CONN as never, NOW, { budgetMs: 1000 });

    expect(summary.incomplete).toBe(true);
    // It got through at least one calendar and not all three — the point is
    // that partial progress is kept, not thrown away.
    const synced = updates.filter((u) => u.table === "google_calendars" && "last_synced_at" in u.patch);
    expect(synced.length).toBeGreaterThan(0);
    expect(synced.length).toBeLessThan(CALENDARS.length);
  });

  // The sweep orders connections by last_sync_at, stalest first. Stamping a
  // partial run as synced would send it to the back of the queue with calendars
  // it never read — the member would be stuck at whatever the budget reached.
  it("leaves last_sync_at alone when it ran out of time", async () => {
    respondSlowly(400);
    const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
    await syncConnection(budgetClient(updates), CONN as never, NOW, { budgetMs: 1000 });

    const connectionUpdates = updates.filter((u) => u.table === "google_calendar_connections");
    expect(connectionUpdates).toHaveLength(0);
  });

  it("records a normal result when the budget is never reached", async () => {
    respondSlowly(1);
    const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
    const summary = await syncConnection(budgetClient(updates), CONN as never, NOW, { budgetMs: 60_000 });

    expect(summary.incomplete).toBe(false);
    expect(updates.some((u) => u.table === "google_calendar_connections" && u.patch.last_sync_at)).toBe(true);
  });

  // A calendar can fail and a LATER one exhaust the budget. Suppressing the
  // record there left last_error clear and the failure count unincremented on a
  // connection that has a calendar which is not syncing — a healthy tick over a
  // broken calendar.
  it("still records a failure when the run also ran out of time", async () => {
    let clock = Date.now();
    jest.spyOn(Date, "now").mockImplementation(() => clock);
    let call = 0;
    fetchMock.mockImplementation(async () => {
      clock += 400;
      call++;
      // The calendar list, then a failing first calendar, then successes.
      if (call === 2) return { ok: false, status: 500, text: async () => "boom", json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ items: [], nextSyncToken: "tok" }) };
    });

    const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
    const summary = await syncConnection(budgetClient(updates), CONN as never, NOW, { budgetMs: 1000 });

    expect(summary.failed).toBeGreaterThan(0);
    expect(summary.incomplete).toBe(true);
    const conn = updates.filter((u) => u.table === "google_calendar_connections");
    expect(conn).toHaveLength(1);
    // Recorded as a failure — and a failure patch carries no last_sync_at, so
    // the partial run still stays at the front of the sweep's queue.
    expect(conn[0].patch).toHaveProperty("last_error");
    expect(conn[0].patch).not.toHaveProperty("last_sync_at");
  });

  // The cron sweep passes no budget and must keep its old behaviour: take as
  // long as the calendars need.
  it("is unbounded when no budget is given", async () => {
    respondSlowly(10_000);
    const updates: Array<{ table: string; patch: Record<string, unknown> }> = [];
    const summary = await syncConnection(budgetClient(updates), CONN as never, NOW);

    expect(summary.incomplete).toBe(false);
    const synced = updates.filter((u) => u.table === "google_calendars" && "last_synced_at" in u.patch);
    expect(synced).toHaveLength(CALENDARS.length);
  });
});
