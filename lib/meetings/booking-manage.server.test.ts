// lib/meetings/booking-manage.server.test.ts
// The one read behind the invitee's manage page, now that two callers share it.
//
// The page reads it on the server and the route serves the same thing to the
// browser, so a change here reaches both. What is worth holding is not the
// wall-clock cost — that is a database round trip and lives in the pull request
// — but which reads happen at all: a booking nobody can move must not pay for a
// slot search, and the tables touched are countable exactly.
jest.mock("next/headers", () => ({ cookies: () => ({ getAll: () => [], set: () => undefined }) }));
jest.mock("@/lib/calendar/feeds.server", () => ({ externalBusyForUser: async () => [] }));
jest.mock("@/lib/calendar/google.server", () => ({ googleBusyForUser: async () => [] }));

import { loadManageView } from "./booking-manage.server";
import { DEFAULT_AVAILABILITY } from "./scheduling";

const BOOKING = {
  id: "b1",
  page_id: "p1",
  event_type_id: "e1",
  meeting_id: "m1",
  manage_token: "tok",
  status: "confirmed",
  starts_at: "2099-10-05T14:00:00.000Z",
  ends_at: "2099-10-05T14:30:00.000Z",
  invitee_name: "Ada",
  invitee_email: "ada@example.com",
  invitee_timezone: "America/New_York",
  invitee_notes: null,
  host_user_id: "host-1",
  organization_id: null,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  calendar_sequence: 0,
  cancelled_by: null,
  cancellation_reason: null,
};

const PAGE = {
  id: "p1",
  user_id: "host-1",
  organization_id: null,
  slug: "ana",
  display_name: "Ana",
  headline: null,
  bio: null,
  timezone: "America/New_York",
  availability: DEFAULT_AVAILABILITY,
  booking_window_days: 21,
  buffer_minutes: 0,
  min_notice_minutes: 60,
  is_active: true,
};

const TYPE = {
  id: "e1",
  page_id: "p1",
  slug: "intro",
  title: "Intro call",
  description: null,
  duration_minutes: 30,
  slot_interval_minutes: 30,
  requires_approval: false,
  is_active: true,
  sort_order: 0,
  meeting_type: "video",
};

/**
 * Answers `maybeSingle()` with a row and a plain await with a list, and records
 * every table it was asked for.
 */
function recordingClient(rows: Record<string, unknown>) {
  const reads: string[] = [];
  return {
    reads,
    client: {
      from(table: string) {
        reads.push(table);
        let single = false;
        const b: Record<string, unknown> = new Proxy(
          {
            then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              Promise.resolve({ data: single ? (rows[table] ?? null) : [], error: null }).then(res, rej),
          },
          {
            get(target: Record<string, unknown>, prop: string) {
              if (prop in target) return target[prop];
              if (prop === "maybeSingle" || prop === "single") single = true;
              return () => b;
            },
          },
        ) as Record<string, unknown>;
        return b;
      },
    },
  };
}

const ROWS = {
  scheduling_bookings: BOOKING,
  scheduling_pages: PAGE,
  scheduling_event_types: TYPE,
  live_meetings: { room_code: "ABC123" },
};

it("returns the booking a token names, with times it could move to", async () => {
  const { client } = recordingClient(ROWS);
  const view = await loadManageView(client as never, "tok");

  expect(view).not.toBeNull();
  expect(view!.booking.inviteeName).toBe("Ada");
  expect(view!.booking.startsAt).toBe("2099-10-05T14:00:00.000Z");
  expect(view!.eventType.title).toBe("Intro call");
  expect(view!.page.displayName).toBe("Ana");
  expect(view!.joinUrl).toContain("ABC123");
  expect(view!.bookingPageUrl).toContain("/book/ana");
  expect(view!.slots.length).toBeGreaterThan(0);
});

it("returns null for a token that names nothing, rather than an empty view", async () => {
  const { client } = recordingClient({ ...ROWS, scheduling_bookings: null });
  expect(await loadManageView(client as never, "nope")).toBeNull();
});

/**
 * A cancelled booking cannot be moved, so the slot search — three more reads and
 * the slot generation on top of them — must not run. This is the read the page
 * pays for on every visit, so "only when there is something to move" is worth an
 * assertion rather than a comment.
 */
it("does not go looking for other times when the booking cannot be moved", async () => {
  for (const status of ["cancelled", "declined"] as const) {
    const { client, reads } = recordingClient({ ...ROWS, scheduling_bookings: { ...BOOKING, status } });
    const view = await loadManageView(client as never, "tok");

    expect(view!.slots).toEqual([]);
    // The three tables a slot search reads, none of which should appear beyond
    // the room-code lookup the view itself needs.
    expect(reads.filter((t) => t === "scheduling_blocks")).toEqual([]);
    expect(reads.filter((t) => t === "scheduling_bookings")).toHaveLength(1);
  }
});

it("still offers other times for a request the host has not answered yet", async () => {
  const { client } = recordingClient({ ...ROWS, scheduling_bookings: { ...BOOKING, status: "pending" } });
  const view = await loadManageView(client as never, "tok");
  expect(view!.booking.status).toBe("pending");
  expect(view!.slots.length).toBeGreaterThan(0);
});

// The page reads this on the server and the route serves it to the browser. If
// the shape drifts, one of them starts reading `undefined` in silence, so the
// fields the page actually draws are named here.
it("carries every field the page draws", async () => {
  const { client } = recordingClient(ROWS);
  const view = await loadManageView(client as never, "tok");
  expect(Object.keys(view!).sort()).toEqual(
    ["booking", "bookingPageUrl", "eventType", "hostTimezone", "joinUrl", "page", "slots"].sort(),
  );
  for (const key of ["id", "eventTitle", "inviteeName", "startsAt", "endsAt", "status", "inviteeTimezone"]) {
    expect(view!.booking).toHaveProperty(key);
  }
});
