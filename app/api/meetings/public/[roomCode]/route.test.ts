// Coverage for the public meeting-lookup used by emailed invites: it must
// resolve a meeting by room code for anonymous guests (via the service role)
// while exposing ONLY non-sensitive fields — never attendees, agenda, or notes.

const from = jest.fn();
const selectSpy = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({ from: (...a: unknown[]) => from(...a) }),
  createServerClient: async () => ({ from: (...a: unknown[]) => from(...a) }),
}));

import { NextRequest } from "next/server";
import { clearRateLimitBucketsForTests } from "@/lib/rate-limit";
import { GET } from "./route";

function req(ip = "198.51.100.7"): NextRequest {
  return new NextRequest("http://localhost/api/meetings/public/abc-defg-hi", {
    headers: { "x-vercel-forwarded-for": ip },
  });
}

// Module state in the limiter, so one test's lookups must not spend another's.
beforeEach(() => clearRateLimitBucketsForTests());

function makeFromStub(result: { data?: unknown; error?: unknown }) {
  return () => {
    const builder: Record<string, unknown> = {
      select: (cols: string) => {
        selectSpy(cols);
        return builder;
      },
      eq: () => builder,
      is: () => builder,
      maybeSingle: async () => ({ data: result.data ?? null, error: result.error ?? null }),
    };
    return builder;
  };
}

beforeEach(() => jest.clearAllMocks());

describe("GET /api/meetings/public/[roomCode]", () => {
  it("returns what the invite screen needs and nothing else", async () => {
    from.mockImplementation(
      makeFromStub({
        // The row may carry sensitive columns; the route must not leak them.
        data: {
          id: "m1",
          title: "Q3 LP Review",
          status: "waiting",
          scheduled_at: "2026-09-10T15:00:00.000Z",
          duration_minutes: 30,
          timezone: "America/New_York",
          is_draft: false,
          objective: "secret",
          attendees: [{ email: "x@y.z" }],
        },
      }),
    );

    const res = await GET(req(), { params: Promise.resolve({ roomCode: "abc-defg-hi" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      id: "m1",
      title: "Q3 LP Review",
      status: "waiting",
      // The time is the one thing an invited person most needs, and it tells
      // the holder of the link nothing their invitation did not already say.
      scheduledAt: "2026-09-10T15:00:00.000Z",
      durationMinutes: 30,
      timezone: "America/New_York",
    });
    expect(body).not.toHaveProperty("objective");
    expect(body).not.toHaveProperty("attendees");
    // Only non-sensitive columns are ever selected.
    expect(selectSpy).toHaveBeenCalledWith(
      "id, title, status, scheduled_at, duration_minutes, timezone, is_draft",
    );
  });

  it("reports no time for a meeting still in draft", async () => {
    // A draft is not a commitment, and a date read off one is a date that can
    // still change without anybody being told.
    from.mockImplementation(
      makeFromStub({
        data: {
          id: "m1",
          title: "Q3 LP Review",
          status: "waiting",
          scheduled_at: "2026-09-10T15:00:00.000Z",
          duration_minutes: 30,
          timezone: "UTC",
          is_draft: true,
        },
      }),
    );

    const body = await (await GET(req(), { params: Promise.resolve({ roomCode: "abc-defg-hi" }) })).json();
    expect(body).toMatchObject({ scheduledAt: null, durationMinutes: null, timezone: null });
  });

  it("defaults a missing title to 'Meeting'", async () => {
    from.mockImplementation(makeFromStub({ data: { id: "m1", title: null, status: "active" } }));
    const res = await GET(req(), { params: Promise.resolve({ roomCode: "abc-defg-hi" }) });
    const body = await res.json();
    expect(body.title).toBe("Meeting");
  });

  it("404s when the meeting is not found", async () => {
    from.mockImplementation(makeFromStub({ data: null }));
    const res = await GET(req(), { params: Promise.resolve({ roomCode: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("404s on a query error rather than leaking it", async () => {
    from.mockImplementation(makeFromStub({ error: { message: "boom" } }));
    const res = await GET(req(), { params: Promise.resolve({ roomCode: "abc-defg-hi" }) });
    expect(res.status).toBe(404);
  });

  it("400s on a blank room code", async () => {
    const res = await GET(req(), { params: Promise.resolve({ roomCode: "  " }) });
    expect(res.status).toBe(400);
  });
});

// Not because a 40-bit room code is guessable, but because this answers "is
// this code real?" to anyone, unauthenticated, and an unbounded oracle is worth
// closing whether or not the search space makes it worth using.
describe("rate limiting", () => {
  it("refuses a caller walking room codes", async () => {
    from.mockImplementation(makeFromStub({ data: null }));
    let refused = false;
    for (let i = 0; i < 200; i++) {
      const res = await GET(req(), { params: Promise.resolve({ roomCode: `code-${i}` }) });
      if (res.status === 429) { refused = true; break; }
    }
    expect(refused).toBe(true);
  });

  it("does not let one address lock out another", async () => {
    from.mockImplementation(makeFromStub({ data: null }));
    for (let i = 0; i < 200; i++) {
      const res = await GET(req("203.0.113.1"), { params: Promise.resolve({ roomCode: `code-${i}` }) });
      if (res.status === 429) break;
    }
    const other = await GET(req("203.0.113.2"), { params: Promise.resolve({ roomCode: "abc-defg-hi" }) });
    expect(other.status).not.toBe(429);
  });
});
