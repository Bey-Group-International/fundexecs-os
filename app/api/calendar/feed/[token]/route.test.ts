/**
 * @jest-environment node
 */
// The published calendar feed. What matters here: a request still waiting on
// the host shows on their calendar as tentative, and a failure reading those
// requests never costs the host their meetings.
const tables: Record<string, { data: unknown; error: unknown }> = {};

jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({
    from(table: string) {
      const result = tables[table] ?? { data: [], error: null };
      const b: Record<string, unknown> = new Proxy(
        {
          maybeSingle: async () => result,
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(result).then(res, rej),
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
  }),
}));

import { GET } from "./route";

const TOKEN = "t".repeat(32);
const inAWeek = (h: number) => new Date(Date.now() + 7 * 86_400_000 + h * 3600_000).toISOString();

async function feed(): Promise<string> {
  const res = await GET({} as never, { params: Promise.resolve({ token: TOKEN }) });
  expect(res.status).toBe(200);
  return res.text();
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.scheduling_pages = { data: { user_id: "u1", display_name: "Ana", timezone: "UTC" }, error: null };
  tables.live_meetings = {
    data: [
      {
        id: "m1",
        room_code: "abc-defg-hij",
        title: "Board call",
        description: null,
        location: null,
        scheduled_at: inAWeek(0),
        duration_minutes: 30,
        updated_at: null,
        status: "waiting",
      },
    ],
    error: null,
  };
});

it("puts a pending booking request on the host's calendar as tentative", async () => {
  tables.scheduling_bookings = {
    data: [
      {
        id: "b1",
        starts_at: inAWeek(2),
        ends_at: inAWeek(2.5),
        invitee_name: "Ada Lovelace",
        calendar_sequence: 3,
        scheduling_event_types: { title: "Intro call" },
      },
    ],
    error: null,
  };
  const ics = await feed();
  expect(ics).toContain("UID:booking-b1@fundexecs");
  expect(ics).toContain("SUMMARY:Requested: Intro call with Ada Lovelace");
  expect(ics).toContain("STATUS:TENTATIVE");
  expect(ics).toContain("SEQUENCE:3");
  // The confirmed meeting is still there, and still confirmed.
  expect(ics).toContain("UID:meeting-m1@fundexecs");
  expect(ics).toContain("STATUS:CONFIRMED");
});

it("still serves the meetings when the requests cannot be read", async () => {
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  tables.scheduling_bookings = { data: null, error: { message: "boom" } };
  const ics = await feed();
  expect(ics).toContain("UID:meeting-m1@fundexecs");
  expect(ics).not.toContain("TENTATIVE");
  errorSpy.mockRestore();
});

it("answers a wrong token with a flat 404", async () => {
  tables.scheduling_pages = { data: null, error: null };
  const res = await GET({} as never, { params: Promise.resolve({ token: TOKEN }) });
  expect(res.status).toBe(404);
});
