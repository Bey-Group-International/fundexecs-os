// The public booking route is the one place an anonymous caller writes to a
// host's calendar. These cover the guarantees that makes safe: the slot is
// re-derived server-side rather than trusted from the request, an approval-gated
// type never creates a room, and an unknown link reveals nothing.

const hasServiceEnv = jest.fn(() => true);
const serviceClient = jest.fn();
const sendBookingEmails = jest.fn(async () => ({ sent: 2 }));

jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => hasServiceEnv(),
  createServiceClient: () => serviceClient(),
}));
jest.mock("@/lib/meetings/scheduling-email", () => ({
  sendBookingEmails: (...args: unknown[]) => sendBookingEmails(...(args as [])),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

type Row = Record<string, unknown>;

/**
 * A chainable, in-memory stand-in for the handful of PostgREST calls this flow
 * makes. Filters are applied eagerly so `maybeSingle()` behaves like the real
 * client for the lookups under test; writes are recorded for assertions.
 */
function makeClient(tables: Record<string, Row[]>) {
  const writes: Record<string, Row[]> = {};
  let seq = 0;

  const from = (name: string) => {
    let rows = [...(tables[name] ?? [])];
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val);
        return builder;
      },
      neq: (col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] !== val);
        return builder;
      },
      in: (col: string, vals: unknown[]) => {
        rows = rows.filter((r) => vals.includes(r[col]));
        return builder;
      },
      is: () => builder,
      gte: () => builder,
      lt: () => builder,
      order: () => builder,
      limit: () => builder,
      insert: (payload: Row) => {
        const row = { id: `${name}-${++seq}`, ...payload };
        writes[name] = [...(writes[name] ?? []), row];
        tables[name] = [...(tables[name] ?? []), row];
        rows = [row];
        return builder;
      },
      update: () => builder,
      delete: () => builder,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
    };
    return builder;
  };

  return { client: { from }, writes };
}

/** Availability that covers the clock, so any :00/:15/:30/:45 start is open. */
const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: "00:00", end: "23:45" }));

function page(overrides: Row = {}): Row {
  return {
    id: "page-1",
    user_id: "host-1",
    organization_id: "org-1",
    slug: "ada",
    display_name: "Ada Lovelace",
    headline: null,
    bio: null,
    timezone: "UTC",
    availability: ALL_WEEK,
    buffer_minutes: 0,
    min_notice_minutes: 0,
    booking_window_days: 30,
    is_active: true,
    ...overrides,
  };
}

function eventType(overrides: Row = {}): Row {
  return {
    id: "type-1",
    page_id: "page-1",
    user_id: "host-1",
    organization_id: "org-1",
    slug: "intro-15",
    title: "Intro call",
    description: null,
    duration_minutes: 15,
    slot_interval_minutes: 15,
    meeting_type: "external_meeting",
    requires_approval: false,
    is_active: true,
    sort_order: 0,
    ...overrides,
  };
}

function tables(overrides: Partial<Record<string, Row[]>> = {}) {
  return {
    scheduling_pages: [page()],
    scheduling_event_types: [eventType()],
    scheduling_bookings: [],
    live_meetings: [],
    principals: [{ id: "host-1", email: "ada@fund.test", full_name: "Ada Lovelace" }],
    ...overrides,
  } as Record<string, Row[]>;
}

/** A quarter-hour boundary comfortably in the future, matching the slot grid. */
function nextSlotIso(offsetMinutes = 120): string {
  const t = Date.now() + offsetMinutes * 60_000;
  return new Date(Math.ceil(t / (15 * 60_000)) * 15 * 60_000).toISOString();
}

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/scheduling/ada/intro-15/book", {
    method: "POST",
    body: JSON.stringify(body),
    // A distinct IP per test keeps the shared rate-limit buckets from bleeding
    // between cases.
    headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250) + 1}` },
  });
}

const params = Promise.resolve({ slug: "ada", eventSlug: "intro-15" });

beforeEach(() => {
  jest.clearAllMocks();
  hasServiceEnv.mockReturnValue(true);
});

describe("POST /api/scheduling/[slug]/[eventSlug]/book", () => {
  it("rejects a request missing invitee details before touching the database", async () => {
    const { client } = makeClient(tables());
    serviceClient.mockReturnValue(client);

    const res = await POST(request({ startIso: nextSlotIso(), name: "", email: "nope" }), { params });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.fieldErrors.name).toBeTruthy();
    expect(body.fieldErrors.email).toBeTruthy();
    expect(sendBookingEmails).not.toHaveBeenCalled();
  });

  it("404s an unknown handle without disclosing why", async () => {
    const { client } = makeClient(tables({ scheduling_pages: [] }));
    serviceClient.mockReturnValue(client);

    const res = await POST(
      request({ startIso: nextSlotIso(), name: "Grace", email: "grace@x.com" }),
      { params },
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("404s an inactive booking page", async () => {
    const { client } = makeClient(tables({ scheduling_pages: [page({ is_active: false })] }));
    serviceClient.mockReturnValue(client);

    const res = await POST(
      request({ startIso: nextSlotIso(), name: "Grace", email: "grace@x.com" }),
      { params },
    );

    expect(res.status).toBe(404);
  });

  it("refuses a time that isn't on the host's offered grid", async () => {
    const { client, writes } = makeClient(tables());
    serviceClient.mockReturnValue(client);

    // Seven minutes past a boundary: plausible-looking, never offered.
    const offGrid = new Date(new Date(nextSlotIso()).getTime() + 7 * 60_000).toISOString();
    const res = await POST(request({ startIso: offGrid, name: "Grace", email: "grace@x.com" }), { params });

    expect(res.status).toBe(409);
    expect(writes.scheduling_bookings).toBeUndefined();
    expect(writes.live_meetings).toBeUndefined();
  });

  it("refuses a time the host is already busy at", async () => {
    const start = nextSlotIso();
    const { client, writes } = makeClient(
      tables({
        live_meetings: [
          {
            id: "m-existing",
            host_id: "host-1",
            scheduled_at: start,
            duration_minutes: 30,
            is_draft: false,
            status: "waiting",
            deleted_at: null,
          },
        ],
      }),
    );
    serviceClient.mockReturnValue(client);

    const res = await POST(request({ startIso: start, name: "Grace", email: "grace@x.com" }), { params });

    expect(res.status).toBe(409);
    expect(writes.scheduling_bookings).toBeUndefined();
  });

  it("refuses a time held by a pending request from someone else", async () => {
    const start = nextSlotIso();
    const { client, writes } = makeClient(
      tables({
        scheduling_bookings: [
          {
            id: "b-held",
            host_user_id: "host-1",
            starts_at: start,
            ends_at: new Date(new Date(start).getTime() + 15 * 60_000).toISOString(),
            status: "pending",
          },
        ],
      }),
    );
    serviceClient.mockReturnValue(client);

    const res = await POST(request({ startIso: start, name: "Grace", email: "grace@x.com" }), { params });

    expect(res.status).toBe(409);
    expect(writes.scheduling_bookings).toBeUndefined();
  });

  it("books an open slot, creating the room and emailing both sides", async () => {
    const start = nextSlotIso();
    const { client, writes } = makeClient(tables());
    serviceClient.mockReturnValue(client);

    const res = await POST(
      request({ startIso: start, name: "Grace Hopper", email: "Grace@X.com", notes: "Fund II", timezone: "Asia/Tokyo" }),
      { params },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("confirmed");
    expect(body.joinUrl).toContain("/meeting-invite/");
    expect(body.manageUrl).toContain("/booking/");

    const meeting = writes.live_meetings[0];
    expect(meeting.host_id).toBe("host-1");
    expect(meeting.organization_id).toBe("org-1");
    expect(meeting.scheduled_at).toBe(start);
    expect(meeting.duration_minutes).toBe(15);
    expect(meeting.attendees).toEqual([{ name: "Grace Hopper", email: "grace@x.com", type: "external" }]);

    const booking = writes.scheduling_bookings[0];
    expect(booking.status).toBe("confirmed");
    expect(booking.invitee_email).toBe("grace@x.com"); // normalized
    expect(booking.invitee_timezone).toBe("Asia/Tokyo");
    expect(String(booking.manage_token)).toHaveLength(32);

    expect(sendBookingEmails).toHaveBeenCalledWith("confirmed", expect.objectContaining({
      hostEmail: "ada@fund.test",
      inviteeEmail: "grace@x.com",
    }));
  });

  it("holds an approval-gated slot as pending and creates no room", async () => {
    const { client, writes } = makeClient(
      tables({ scheduling_event_types: [eventType({ requires_approval: true })] }),
    );
    serviceClient.mockReturnValue(client);

    const res = await POST(
      request({ startIso: nextSlotIso(), name: "Grace", email: "grace@x.com" }),
      { params },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("pending");
    expect(body.joinUrl).toBeNull();

    expect(writes.live_meetings).toBeUndefined();
    expect(writes.scheduling_bookings[0].status).toBe("pending");
    expect(writes.scheduling_bookings[0].meeting_id).toBeNull();
    expect(sendBookingEmails).toHaveBeenCalledWith("requested", expect.anything());
  });

  it("reports scheduling as unconfigured rather than half-working", async () => {
    hasServiceEnv.mockReturnValue(false);
    const res = await POST(request({ startIso: nextSlotIso(), name: "G", email: "g@x.com" }), { params });
    expect(res.status).toBe(503);
    expect(serviceClient).not.toHaveBeenCalled();
  });
});
