// lib/calendar/google-write.server.test.ts
// The write half. What matters here is that a failed push never claims to have
// synced — the stub this replaces did exactly that.
const accessTokenForMock = jest.fn();

jest.mock("@/lib/calendar/google.server", () => ({
  accessTokenFor: (...a: unknown[]) => accessTokenForMock(...a),
}));

import { findEventByMarker, lookupEventByMarker, pushMeetingToGoogle, writeTargetFor } from "./google-write.server";
import type { WritableMeeting } from "./google-write";

const fetchMock = jest.fn();

function meeting(over: Partial<WritableMeeting> = {}): WritableMeeting {
  return {
    id: "mtg-1",
    title: "Q3 LP update",
    description: null,
    location: null,
    meeting_url: null,
    objective: null,
    agenda: null,
    scheduled_at: "2026-09-01T15:00:00.000Z",
    duration_minutes: 45,
    timezone: "America/New_York",
    calendar_visibility: null,
    reminder_minutes: null,
    attendees: null,
    is_draft: false,
    locked_at: "2026-08-26T10:00:00.000Z",
    deleted_at: null,
    external_calendar_event_id: null,
    external_calendar_sync_enabled: true,
    // "google_calendar", because that is the only spelling the
    // live_meetings_external_provider_check constraint allows — so a row
    // carrying "google" is one the database could never have produced. The
    // fixture said "google" while the writer wrote "google" and every write was
    // rejected in production; a fixture agreeing with a bug is how it survived.
    external_calendar_provider: "google_calendar",
    ...over,
  };
}

/** Records what was written back to live_meetings so assertions can read it. */
interface Recorded {
  updates: Array<Record<string, unknown>>;
}

function client(opts: { conn?: unknown; calendar?: unknown } = {}, recorded: Recorded = { updates: [] }) {
  const conn = "conn" in opts ? opts.conn : { id: "c1", user_id: "u1", refresh_ciphertext: "ct", refresh_iv: "iv", refresh_auth_tag: "tag" };
  const calendar = "calendar" in opts ? opts.calendar : { google_calendar_id: "primary@example.com", access_role: "owner", is_primary: true };

  const api = {
    from(table: string) {
      if (table === "google_calendar_connections") {
        return chain({ maybeSingle: async () => ({ data: conn }) });
      }
      if (table === "google_calendars") {
        return chain({ maybeSingle: async () => ({ data: calendar }) });
      }
      // live_meetings — capture the update payload.
      return {
        update(payload: Record<string, unknown>) {
          recorded.updates.push(payload);
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
  return { api: api as never, recorded };
}

/** A chainable Supabase-ish stub that ends at maybeSingle. */
function chain(terminal: { maybeSingle: () => Promise<{ data: unknown }> }) {
  const self: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) {
    self[m] = () => self;
  }
  self.maybeSingle = terminal.maybeSingle;
  return self;
}

function respond(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (status === 204 ? "" : JSON.stringify(body)),
    json: async () => body,
  };
}

/**
 * Route the marker lookup and the write separately.
 *
 * A create now asks Google whether an event for this meeting already exists
 * before making one, so the write is no longer the first fetch.
 */
function routeFetch(opts: { existing?: string | null; write: ReturnType<typeof respond> }) {
  return (url: URL | string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && String(url).includes("privateExtendedProperty")) {
      return Promise.resolve(
        respond(200, { items: opts.existing ? [{ id: opts.existing, status: "confirmed" }] : [] }),
      );
    }
    return Promise.resolve(opts.write);
  };
}

/** The write call, skipping the marker lookup. */
function writeCall() {
  return fetchMock.mock.calls.find(([, init]) => (init as { method?: string } | undefined)?.method);
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  accessTokenForMock.mockResolvedValue({ ok: true, data: "access-token" });
});

describe("writeTargetFor", () => {
  it("finds the connection and a writable calendar", async () => {
    const { api } = client();
    const target = await writeTargetFor(api, "u1");
    expect(target?.calendarId).toBe("primary@example.com");
  });

  it("is null when nothing is connected", async () => {
    const { api } = client({ conn: null });
    expect(await writeTargetFor(api, "u1")).toBeNull();
  });

  it("is null when no calendar can be written to", async () => {
    // A member with only read access to every calendar would 403 on every
    // write; better to report "not connected" than to fail forever.
    const { api } = client({ calendar: null });
    expect(await writeTargetFor(api, "u1")).toBeNull();
  });
});

describe("pushMeetingToGoogle — create", () => {
  it("POSTs a new event and stores the id Google returns", async () => {
    fetchMock.mockImplementation(routeFetch({ existing: null, write: respond(200, { id: "gcal-new" }) }));
    const { api, recorded } = client();

    const r = await pushMeetingToGoogle(api, meeting(), "u1");

    expect(r).toMatchObject({ ok: true, status: "synced", eventId: "gcal-new", action: "created" });
    const [url, init] = writeCall()!;
    expect(String(url)).toContain("/calendars/primary%40example.com/events");
    expect((init as { method: string }).method).toBe("POST");
    expect(recorded.updates.at(-1)).toMatchObject({
      external_calendar_sync_status: "synced",
      external_calendar_event_id: "gcal-new",
      external_calendar_last_error: null,
    });
  });

  it("tells Google to notify the guests", async () => {
    fetchMock.mockImplementation(routeFetch({ existing: null, write: respond(200, { id: "gcal-new" }) }));
    const { api } = client();
    await pushMeetingToGoogle(api, meeting(), "u1");
    expect(String(writeCall()![0])).toContain("sendUpdates=all");
  });

  it("puts a series meeting on the host's calendar alone, telling no guest", async () => {
    fetchMock.mockImplementation(routeFetch({ existing: null, write: respond(200, { id: "gcal-new" }) }));
    const { api } = client();
    await pushMeetingToGoogle(
      api,
      meeting({ series_id: "s1", attendees: [{ name: "Ada", email: "ada@lp.test" }] }),
      "u1",
    );
    const [url, init] = writeCall()!;
    expect(String(url)).toContain("sendUpdates=none");
    expect(JSON.parse(String((init as { body?: string }).body)).attendees).toEqual([]);
  });

  it("creates rather than patches when the id is a legacy stub", async () => {
    fetchMock.mockImplementation(routeFetch({ existing: null, write: respond(200, { id: "gcal-real" }) }));
    const { api } = client();
    await pushMeetingToGoogle(api, meeting({ external_calendar_event_id: "ext_old-fake" }), "u1");
    expect((writeCall()![1] as { method: string }).method).toBe("POST");
  });

  it("adopts an orphaned event instead of creating a duplicate", async () => {
    // A previous run wrote the event but lost the id before storing it. Making
    // a second one would put the same meeting on the calendar twice.
    fetchMock.mockImplementation(routeFetch({ existing: "gcal-orphan", write: respond(200, { id: "gcal-orphan" }) }));
    const { api, recorded } = client();

    const r = await pushMeetingToGoogle(api, meeting({ external_calendar_event_id: null }), "u1");

    expect((writeCall()![1] as { method: string }).method).toBe("PATCH");
    expect(String(writeCall()![0])).toContain("/events/gcal-orphan");
    expect(r).toMatchObject({ ok: true, action: "updated", eventId: "gcal-orphan" });
    expect(recorded.updates.at(-1)).toMatchObject({ external_calendar_event_id: "gcal-orphan" });
  });

  it("does not claim a sync when the event id could not be recorded", async () => {
    // The event exists on Google but the row does not know its id. Reporting
    // "synced" would be exactly the lie this change removes.
    const recorded: Recorded = { updates: [] };
    const api = {
      from(table: string) {
        if (table === "google_calendar_connections") {
          return chain({ maybeSingle: async () => ({ data: { id: "c1", user_id: "u1" } }) });
        }
        if (table === "google_calendars") {
          return chain({ maybeSingle: async () => ({ data: { google_calendar_id: "primary@example.com", access_role: "owner" } }) });
        }
        return {
          update(payload: Record<string, unknown>) {
            recorded.updates.push(payload);
            return { eq: async () => ({ error: { message: "row level security" } }) };
          },
        };
      },
    } as never;

    fetchMock.mockImplementation(routeFetch({ existing: null, write: respond(200, { id: "gcal-new" }) }));

    const r = await pushMeetingToGoogle(api, meeting(), "u1");

    expect(r.ok).toBe(false);
    expect(r.status).toBe("sync_pending");
    expect(r.eventId).toBe("gcal-new");
    expect(String(r.error)).toContain("could not be recorded");
  });
});

describe("pushMeetingToGoogle — update", () => {
  it("PATCHes an existing event and keeps its id", async () => {
    fetchMock.mockImplementation(routeFetch({ write: respond(200, { id: "gcal-1" }) }));
    const { api, recorded } = client();

    const r = await pushMeetingToGoogle(api, meeting({ external_calendar_event_id: "gcal-1" }), "u1");

    expect(r).toMatchObject({ ok: true, action: "updated", eventId: "gcal-1" });
    expect((writeCall()![1] as { method: string }).method).toBe("PATCH");
    expect(String(writeCall()![0])).toContain("/events/gcal-1");

    // A known id needs no lookup — that request is only for recovering orphans.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("privateExtendedProperty"))).toBe(false);
    expect(recorded.updates.at(-1)).toMatchObject({ external_calendar_sync_status: "synced" });
  });
});

describe("pushMeetingToGoogle — delete", () => {
  it("removes the event when sync is switched off", async () => {
    fetchMock.mockImplementation(routeFetch({ write: respond(204) }));
    const { api, recorded } = client();

    const r = await pushMeetingToGoogle(
      api,
      meeting({ external_calendar_event_id: "gcal-1", external_calendar_sync_enabled: false }),
      "u1",
    );

    expect(r).toMatchObject({ ok: true, status: "sync_off", action: "deleted", eventId: null });
    expect((writeCall()![1] as { method: string }).method).toBe("DELETE");
    expect(recorded.updates.at(-1)).toMatchObject({ external_calendar_event_id: null });
  });

  it("treats an already-deleted event as success rather than a stuck id", async () => {
    fetchMock.mockImplementation(routeFetch({ write: respond(404, { error: { message: "Not Found" } }) }));
    const { api, recorded } = client();

    const r = await pushMeetingToGoogle(
      api,
      meeting({ external_calendar_event_id: "gcal-1", external_calendar_sync_enabled: false }),
      "u1",
    );

    expect(r.ok).toBe(true);
    expect(recorded.updates.at(-1)).toMatchObject({ external_calendar_event_id: null });
  });
});

describe("pushMeetingToGoogle — refusals", () => {
  it("never calls Google for a draft, and never claims it synced", async () => {
    const { api, recorded } = client();
    const r = await pushMeetingToGoogle(api, meeting({ is_draft: true }), "u1");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(recorded.updates.at(-1)!.external_calendar_sync_status).not.toBe("synced");
  });

  it("reports not_connected when there is no connection", async () => {
    const { api } = client({ conn: null });
    const r = await pushMeetingToGoogle(api, meeting(), "u1");
    expect(r.status).toBe("not_connected");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not push an unscheduled meeting", async () => {
    const { api } = client();
    const r = await pushMeetingToGoogle(api, meeting({ scheduled_at: null }), "u1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });
});

describe("pushMeetingToGoogle — failures", () => {
  it("records a failure when the token cannot be minted", async () => {
    accessTokenForMock.mockResolvedValue({ ok: false, error: "invalid_grant: revoked" });
    const { api, recorded } = client();

    const r = await pushMeetingToGoogle(api, meeting(), "u1");

    expect(r.status).toBe("sync_failed");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recorded.updates.at(-1)).toMatchObject({ external_calendar_sync_status: "sync_failed" });
    expect(String(recorded.updates.at(-1)!.external_calendar_last_error)).toContain("invalid_grant");
  });

  it("forgets the event id when Google no longer has it", async () => {
    fetchMock.mockImplementation(routeFetch({ write: respond(404, { error: { message: "Not Found" } }) }));
    const { api, recorded } = client();

    const r = await pushMeetingToGoogle(api, meeting({ external_calendar_event_id: "gcal-gone" }), "u1");

    expect(r.ok).toBe(false);
    expect(r.status).toBe("sync_pending");
    // Next attempt must create a fresh event, not patch a ghost forever.
    expect(recorded.updates.at(-1)).toMatchObject({ external_calendar_event_id: null });
  });

  it("keeps the id on a rate limit, which is worth retrying", async () => {
    fetchMock.mockImplementation(routeFetch({ write: respond(429, { error: { message: "Rate Limit Exceeded" } }) }));
    const { api, recorded } = client();

    const r = await pushMeetingToGoogle(api, meeting({ external_calendar_event_id: "gcal-1" }), "u1");

    expect(r.status).toBe("sync_pending");
    expect(recorded.updates.at(-1)).toMatchObject({ external_calendar_event_id: "gcal-1" });
  });

  it("does not claim a sync when the network is down", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const { api, recorded } = client();

    const r = await pushMeetingToGoogle(api, meeting(), "u1");

    expect(r.ok).toBe(false);
    expect(recorded.updates.at(-1)!.external_calendar_sync_status).not.toBe("synced");
  });

  it("does not throw when Google times out", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValue(timeout);
    const { api } = client();

    await expect(pushMeetingToGoogle(api, meeting(), "u1")).resolves.toMatchObject({ ok: false });
  });

  it("records a failure rather than throwing on an unbuildable event", async () => {
    const { api, recorded } = client();
    const r = await pushMeetingToGoogle(api, meeting({ scheduled_at: "not-a-date" }), "u1");
    expect(r.status).toBe("sync_failed");
    expect(recorded.updates.at(-1)!.external_calendar_sync_status).toBe("sync_failed");
  });
});

// ── The provider the row is stamped with ─────────────────────────────────────
//
// This shipped broken. recordSync wrote `external_calendar_provider: "google"`,
// and the schema's `live_meetings_external_provider_check` accepts only
// 'google_calendar', 'outlook', 'calendly' and 'ical' — so EVERY write here was
// rejected by Postgres: on success, so a meeting's event went onto the calendar
// and its row never learned the event id; and on failure, so a sync that failed
// never recorded that either. What a host saw was "external calendar sync
// failed: ... violates check constraint".
//
// Nothing caught it, and the reason is the point of these two tests. A mocked
// Supabase client has no constraints to violate, so no amount of unit testing
// the write could see it — and the fixture above asserted "google" too, which
// is a test agreeing with the bug. The only real guard is to tie the value the
// code writes to the schema that has to accept it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SYNCABLE_PROVIDER } from "@/lib/meetings/calendar-sync";

/** The provider values the live_meetings check constraint actually permits. */
function providersTheSchemaAccepts(): string[] {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/20260705170000_schedule_meeting_flow.sql"),
    "utf8",
  );
  const match = sql.match(/external_calendar_provider in \(([^)]*)\)/);
  if (!match) throw new Error("could not find the external provider check constraint");
  return match[1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
}

describe("the provider written to live_meetings", () => {
  it("is one the schema's check constraint accepts", () => {
    // The assertion that was missing. It reads the migration rather than
    // restating a list, so a constraint narrowed later fails here instead of in
    // production.
    expect(providersTheSchemaAccepts()).toContain(SYNCABLE_PROVIDER);
  });

  it("is not the value that used to be written", () => {
    // Pinned explicitly, because "google" is the obvious thing to type and the
    // constraint is four files away.
    expect(providersTheSchemaAccepts()).not.toContain("google");
    expect(SYNCABLE_PROVIDER).not.toBe("google");
  });

  it("is what a successful push stamps on the row", async () => {
    fetchMock.mockImplementation(routeFetch({ existing: null, write: respond(200, { id: "gcal-new" }) }));
    const { api, recorded } = client();

    const r = await pushMeetingToGoogle(api, meeting(), "u1");

    expect(r.ok).toBe(true);
    const providers = recorded.updates.map((u) => u.external_calendar_provider);
    expect(providers.length).toBeGreaterThan(0);
    for (const written of providers) {
      expect(providersTheSchemaAccepts()).toContain(written);
    }
  });

  it("is what a FAILED push stamps too, which is the half that was silent", async () => {
    // recordSync runs on both outcomes, so the constraint violation took the
    // error trail down with it: a sync that failed could not even record that
    // it had failed.
    fetchMock.mockImplementation(
      routeFetch({ existing: null, write: respond(500, { error: { message: "boom" } }) }),
    );
    const { api, recorded } = client();

    const r = await pushMeetingToGoogle(api, meeting(), "u1");

    expect(r.ok).toBe(false);
    const providers = recorded.updates.map((u) => u.external_calendar_provider);
    expect(providers.length).toBeGreaterThan(0);
    for (const written of providers) {
      expect(providersTheSchemaAccepts()).toContain(written);
    }
  });
});

// ── Two answers the write path could not use, and a repair cannot do without ──
//
// findEventByMarker collapses "there is no such event" and "I could not reach
// Google" to null. That is right where it is used: recovery before a write is
// best-effort, and a failed lookup must not stop the write. It is wrong for
// anything that REPORTS what it found — the repair sweep counts these for a
// person to read, and "no event carries this marker" is a chore somebody might
// go and do by hand, while "Google was unreachable" is a reason to look again.
describe("lookupEventByMarker", () => {
  it("finds the event the marker points at", async () => {
    fetchMock.mockResolvedValue(respond(200, { items: [{ id: "evt-1", status: "confirmed" }] }));
    await expect(lookupEventByMarker("tok", "primary@example.com", "mtg-1")).resolves.toEqual({
      ok: true,
      eventId: "evt-1",
    });
  });

  it("says plainly that there is no event, rather than that it failed", async () => {
    fetchMock.mockResolvedValue(respond(200, { items: [] }));
    await expect(lookupEventByMarker("tok", "primary@example.com", "mtg-1")).resolves.toEqual({
      ok: true,
      eventId: null,
    });
  });

  it("ignores a cancelled event, which is not one to reattach", async () => {
    fetchMock.mockResolvedValue(respond(200, { items: [{ id: "evt-x", status: "cancelled" }] }));
    await expect(lookupEventByMarker("tok", "primary@example.com", "mtg-1")).resolves.toEqual({
      ok: true,
      eventId: null,
    });
  });

  it("reports a refusal as a failure, not as an absence", async () => {
    fetchMock.mockResolvedValue(respond(403, { error: { message: "forbidden" } }));
    const r = await lookupEventByMarker("tok", "primary@example.com", "mtg-1");
    expect(r.ok).toBe(false);
    expect(String((r as { error: string }).error)).toContain("403");
  });

  it("reports a network failure as a failure too", async () => {
    fetchMock.mockRejectedValue(new Error("socket hang up"));
    const r = await lookupEventByMarker("tok", "primary@example.com", "mtg-1");
    expect(r.ok).toBe(false);
    expect(String((r as { error: string }).error)).toContain("socket hang up");
  });

  it("queries by the meeting's private marker", async () => {
    fetchMock.mockResolvedValue(respond(200, { items: [] }));
    await lookupEventByMarker("tok", "primary@example.com", "mtg-abc");
    expect(String(fetchMock.mock.calls[0][0])).toContain("privateExtendedProperty");
    expect(String(fetchMock.mock.calls[0][0])).toContain("mtg-abc");
  });
});

describe("findEventByMarker still flattens, for the write path", () => {
  // The write path cannot act on the difference and must keep behaving exactly as
  // it did, so splitting the lookup must not have changed what it sees.
  it("gives the id when there is one", async () => {
    fetchMock.mockResolvedValue(respond(200, { items: [{ id: "evt-1", status: "confirmed" }] }));
    await expect(findEventByMarker("tok", "primary@example.com", "mtg-1")).resolves.toBe("evt-1");
  });

  it("gives null for an absence AND for a failure, as before", async () => {
    fetchMock.mockResolvedValue(respond(200, { items: [] }));
    await expect(findEventByMarker("tok", "primary@example.com", "mtg-1")).resolves.toBeNull();

    fetchMock.mockResolvedValue(respond(500, {}));
    await expect(findEventByMarker("tok", "primary@example.com", "mtg-1")).resolves.toBeNull();

    fetchMock.mockRejectedValue(new Error("network"));
    await expect(findEventByMarker("tok", "primary@example.com", "mtg-1")).resolves.toBeNull();
  });
});
