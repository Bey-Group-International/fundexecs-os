// Bookings are read and written service-role (the invitee who created them has
// no session), which means RLS is not what stops one host acting on another
// host's booking — this route's explicit ownership check is. That check, and
// the approve/decline/cancel transitions, are what these cover.

const authMock = jest.fn();
const serviceClient = jest.fn();
const sendBookingEmails = jest.fn(async () => ({ sent: 1 }));

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => serviceClient(),
}));
jest.mock("@/lib/meetings/scheduling-email", () => ({
  sendBookingEmails: (...args: unknown[]) => sendBookingEmails(...(args as [])),
}));

import { NextRequest } from "next/server";
import { PATCH } from "./route";

type Row = Record<string, unknown>;

function makeClient(tables: Record<string, Row[]>) {
  const updates: Record<string, Row[]> = {};
  const inserts: Record<string, Row[]> = {};
  let seq = 0;

  const from = (name: string) => {
    let rows = [...(tables[name] ?? [])];
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val);
        return builder;
      },
      neq: () => builder,
      in: () => builder,
      is: () => builder,
      gte: () => builder,
      lt: () => builder,
      order: () => builder,
      limit: () => builder,
      insert: (payload: Row) => {
        const row = { id: `${name}-${++seq}`, ...payload };
        inserts[name] = [...(inserts[name] ?? []), row];
        rows = [row];
        return builder;
      },
      update: (payload: Row) => {
        updates[name] = [...(updates[name] ?? []), payload];
        rows = rows.map((r) => ({ ...r, ...payload }));
        return builder;
      },
      delete: () => builder,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
    };
    return builder;
  };

  return { client: { from }, updates, inserts };
}

const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: "00:00", end: "23:45" }));

function nextSlotIso(offsetMinutes = 180): string {
  const t = Date.now() + offsetMinutes * 60_000;
  return new Date(Math.ceil(t / (15 * 60_000)) * 15 * 60_000).toISOString();
}

function tables(bookingOverrides: Row = {}) {
  const startsAt = (bookingOverrides.starts_at as string) ?? nextSlotIso();
  return {
    scheduling_bookings: [
      {
        id: "b-1",
        page_id: "page-1",
        event_type_id: "type-1",
        host_user_id: "host-1",
        organization_id: "org-1",
        meeting_id: null,
        invitee_name: "Grace",
        invitee_email: "grace@x.com",
        invitee_notes: null,
        invitee_timezone: "UTC",
        starts_at: startsAt,
        ends_at: new Date(new Date(startsAt).getTime() + 15 * 60_000).toISOString(),
        status: "pending",
        manage_token: "tok",
        ...bookingOverrides,
      },
    ],
    scheduling_pages: [
      {
        id: "page-1",
        user_id: "host-1",
        organization_id: "org-1",
        slug: "ada",
        display_name: "Ada",
        timezone: "UTC",
        availability: ALL_WEEK,
        buffer_minutes: 0,
        min_notice_minutes: 0,
        booking_window_days: 30,
        is_active: true,
      },
    ],
    scheduling_event_types: [
      {
        id: "type-1",
        page_id: "page-1",
        slug: "intro-15",
        title: "Intro call",
        duration_minutes: 15,
        slot_interval_minutes: 15,
        meeting_type: "external_meeting",
        requires_approval: true,
        is_active: true,
      },
    ],
    live_meetings: [],
  } as Record<string, Row[]>;
}

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/meetings/scheduling/bookings/b-1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "b-1" });

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({
    ok: true,
    ctx: { orgId: "org-1", userId: "host-1", email: "ada@fund.test", role: "owner" },
  });
});

describe("PATCH /api/meetings/scheduling/bookings/[id]", () => {
  it("rejects an unauthenticated caller", async () => {
    authMock.mockResolvedValue({ ok: false, status: 401, error: "Not authenticated" });
    const res = await PATCH(request({ action: "approve" }), { params });
    expect(res.status).toBe(401);
    expect(serviceClient).not.toHaveBeenCalled();
  });

  it("rejects an unknown action before loading anything", async () => {
    const res = await PATCH(request({ action: "delete-everything" }), { params });
    expect(res.status).toBe(400);
    expect(serviceClient).not.toHaveBeenCalled();
  });

  it("hides another host's booking behind a 404 and changes nothing", async () => {
    const { client, updates, inserts } = makeClient(tables());
    serviceClient.mockReturnValue(client);
    authMock.mockResolvedValue({
      ok: true,
      ctx: { orgId: "org-2", userId: "someone-else", email: "x@y.test", role: "owner" },
    });

    const res = await PATCH(request({ action: "approve" }), { params });

    expect(res.status).toBe(404);
    expect(updates.scheduling_bookings).toBeUndefined();
    expect(inserts.live_meetings).toBeUndefined();
    expect(sendBookingEmails).not.toHaveBeenCalled();
  });

  it("approves a pending request, creating the room and confirming the invitee", async () => {
    const { client, updates, inserts } = makeClient(tables());
    serviceClient.mockReturnValue(client);

    const res = await PATCH(request({ action: "approve" }), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.booking.status).toBe("confirmed");
    expect(body.roomCode).toBeTruthy();

    expect(inserts.live_meetings[0].host_id).toBe("host-1");
    expect(updates.scheduling_bookings[0]).toMatchObject({ status: "confirmed" });
    expect(sendBookingEmails).toHaveBeenCalledWith("confirmed", expect.objectContaining({
      inviteeEmail: "grace@x.com",
    }));
  });

  it("declines a pending request without ever creating a room", async () => {
    const { client, updates, inserts } = makeClient(tables());
    serviceClient.mockReturnValue(client);

    const res = await PATCH(request({ action: "decline", reason: "Travelling" }), { params });

    expect(res.status).toBe(200);
    expect(updates.scheduling_bookings[0]).toMatchObject({
      status: "declined",
      cancellation_reason: "Travelling",
    });
    expect(inserts.live_meetings).toBeUndefined();
    expect(sendBookingEmails).toHaveBeenCalledWith("declined", expect.anything());
  });

  it("cancelling a confirmed booking also takes its meeting off the calendar", async () => {
    const { client, updates } = makeClient(
      tables({ status: "confirmed", meeting_id: "m-1" }),
    );
    serviceClient.mockReturnValue(client);

    const res = await PATCH(request({ action: "cancel", reason: "Conflict" }), { params });

    expect(res.status).toBe(200);
    expect(updates.live_meetings[0]).toMatchObject({ status: "ended" });
    expect(updates.live_meetings[0].deleted_at).toBeTruthy();
    expect(updates.scheduling_bookings[0]).toMatchObject({ status: "cancelled", cancelled_by: "host" });
    expect(sendBookingEmails).toHaveBeenCalledWith("cancelled_by_host", expect.anything());
  });

  it("refuses to approve a request whose slot the host has since filled", async () => {
    const startsAt = nextSlotIso();
    const base = tables({ starts_at: startsAt });
    base.live_meetings = [
      {
        id: "m-conflict",
        host_id: "host-1",
        scheduled_at: startsAt,
        duration_minutes: 30,
        is_draft: false,
        status: "waiting",
        deleted_at: null,
      },
    ];
    const { client, updates } = makeClient(base);
    serviceClient.mockReturnValue(client);

    const res = await PATCH(request({ action: "approve" }), { params });

    expect(res.status).toBe(409);
    expect(updates.scheduling_bookings).toBeUndefined();
  });
});
