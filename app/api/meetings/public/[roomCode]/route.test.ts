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
import { GET } from "./route";

function req(): NextRequest {
  return new NextRequest("http://localhost/api/meetings/public/abc-defg-hi");
}

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
  it("returns only id, title and status for a found meeting", async () => {
    from.mockImplementation(
      makeFromStub({
        // The row may carry sensitive columns; the route must not leak them.
        data: { id: "m1", title: "Q3 LP Review", status: "waiting", objective: "secret", attendees: [{ email: "x@y.z" }] },
      }),
    );

    const res = await GET(req(), { params: Promise.resolve({ roomCode: "abc-defg-hi" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: "m1", title: "Q3 LP Review", status: "waiting" });
    expect(body).not.toHaveProperty("objective");
    expect(body).not.toHaveProperty("attendees");
    // Only non-sensitive columns are ever selected.
    expect(selectSpy).toHaveBeenCalledWith("id, title, status");
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
