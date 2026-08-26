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
  it("does not store an event this app pushed", async () => {
    // Without this, every FundExecs meeting synced to Google returns as a
    // second, "external" copy of itself — and that copy blocks the very time
    // the meeting already occupies.
    const upserts: unknown[][] = [];
    const client = {
      from: () => ({
        delete: () => ({ eq: () => ({ in: async () => ({ error: null }) }) }),
        upsert: async (rows: unknown[]) => {
          upserts.push(rows);
          return { error: null };
        },
      }),
    } as never;

    const summary = await applyEvents(client, "cal-1", "user-1", [
      {
        id: "ours",
        status: "confirmed",
        summary: "Q3 LP update",
        start: { dateTime: "2026-09-01T15:00:00Z" },
        end: { dateTime: "2026-09-01T16:00:00Z" },
        extendedProperties: { private: { fundexecsMeetingId: "mtg-1" } },
      },
      {
        id: "theirs",
        status: "confirmed",
        summary: "Dentist",
        start: { dateTime: "2026-09-01T09:00:00Z" },
        end: { dateTime: "2026-09-01T10:00:00Z" },
      },
    ]);

    expect(summary.skipped).toBe(1);
    expect(summary.upserted).toBe(1);
    const stored = upserts.flat() as Array<{ google_event_id: string }>;
    expect(stored.map((r) => r.google_event_id)).toEqual(["theirs"]);
  });
});
