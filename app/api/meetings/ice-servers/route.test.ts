/**
 * ICE servers for a meeting's peer connections.
 *
 * The property under test is WHO may have them. This endpoint used to require a
 * signed-in user, which denied invite-link guests — the one population always on
 * somebody else's network, and so the one that actually needs a TURN relay. The
 * client swallowed the 401 and fell back to STUN alone, so guests' cameras and
 * microphones opened and then connected to nobody.
 *
 * Being signed in was the wrong question. The right one is whether the host has
 * admitted this person to this meeting, so the tests below are mostly about the
 * admission ladder: admitted gets credentials, waiting/denied/absent does not.
 */
const from = jest.fn();
const getUser = jest.fn(async () => ({ data: { user: null as { id: string } | null } }));

jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({ from: (...a: unknown[]) => from(...a) }),
  createServerClient: async () => ({ from: (...a: unknown[]) => from(...a), auth: { getUser: () => getUser() } }),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const TURN = [{ urls: "turn:relay.example:3478", username: "u", credential: "c" }];

/** The admissions lookup: one row when the guest is admitted, else nothing. */
function admissionsBuilder(row: unknown) {
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b, is: () => b, neq: () => b,
    maybeSingle: async () => ({ data: row ?? null, error: null }),
  };
  return b;
}

/** A distinct IP per test, so one test's requests never spend another's budget. */
let ipCounter = 0;
function req(query = "", ip?: string) {
  return new NextRequest(`http://localhost/api/meetings/ice-servers${query}`, {
    headers: { "x-forwarded-for": ip ?? `10.0.0.${++ipCounter}` },
  });
}

const ADMITTED = { id: "adm1", status: "admitted" };

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: null } });
  from.mockImplementation(() => admissionsBuilder(null));
  process.env.METERED_API_KEY = "test-key";
  global.fetch = jest.fn(async () => new Response(JSON.stringify(TURN), { status: 200 })) as unknown as typeof fetch;
});

afterEach(() => { delete process.env.METERED_API_KEY; });

describe("who gets credentials", () => {
  it("gives them to a signed-in member, with no room code needed", async () => {
    // Someone opening a room on the fly has no room code yet.
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).iceServers).toEqual(TURN);
  });

  it("gives them to an admitted guest", async () => {
    from.mockImplementation(() => admissionsBuilder(ADMITTED));
    const res = await GET(req("?roomCode=abc-defg-hi&guestKey=g1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.iceServers).toEqual(TURN);
    expect(body.relay).toBe(true);
  });

  it("refuses a guest who has not been admitted", async () => {
    // The query filters on status='admitted', so a waiting or denied guest
    // simply yields no row — the same answer as never having knocked.
    from.mockImplementation(() => admissionsBuilder(null));
    expect((await GET(req("?roomCode=abc-defg-hi&guestKey=g1"))).status).toBe(401);
  });

  it("refuses a caller with no session and no admission key", async () => {
    expect((await GET(req())).status).toBe(401);
  });

  it("refuses a room code without a guest key, and vice versa", async () => {
    from.mockImplementation(() => admissionsBuilder(ADMITTED));
    expect((await GET(req("?roomCode=abc-defg-hi"))).status).toBe(401);
    expect((await GET(req("?guestKey=g1"))).status).toBe(401);
  });

  it("asks the database for an admitted row on a live meeting, not just any row", async () => {
    const calls: string[] = [];
    from.mockImplementation((table: string) => {
      const b: Record<string, unknown> = {
        select: (sel: string) => { calls.push(`select:${sel}`); return b; },
        eq: (col: string, val: unknown) => { calls.push(`eq:${col}=${String(val)}`); return b; },
        is: (col: string, val: unknown) => { calls.push(`is:${col}=${String(val)}`); return b; },
        neq: (col: string, val: unknown) => { calls.push(`neq:${col}=${String(val)}`); return b; },
        maybeSingle: async () => ({ data: ADMITTED, error: null }),
      };
      calls.push(`from:${table}`);
      return b;
    });
    await GET(req("?roomCode=abc-defg-hi&guestKey=g1"));
    expect(calls).toContain("from:live_meeting_admissions");
    expect(calls).toContain("eq:status=admitted");
    expect(calls).toContain("eq:guest_key=g1");
    expect(calls).toContain("eq:live_meetings.room_code=abc-defg-hi");
    // An ended meeting needs no relay, and a deleted one no longer exists.
    expect(calls).toContain("neq:live_meetings.status=ended");
    expect(calls).toContain("is:live_meetings.deleted_at=null");
    // `!inner` is what makes the meeting filters exclude the row rather than
    // just null out the join.
    expect(calls.some((c) => c.startsWith("select:") && c.includes("live_meetings!inner"))).toBe(true);
  });
});

describe("when TURN is unavailable", () => {
  beforeEach(() => { getUser.mockResolvedValue({ data: { user: { id: "u1" } } }); });

  it("says so rather than implying a relay exists", async () => {
    delete process.env.METERED_API_KEY;
    const body = await (await GET(req())).json();
    expect(body.relay).toBe(false);
    expect(body.iceServers.every((s: { urls: string }) => s.urls.startsWith("stun:"))).toBe(true);
  });

  it("falls back to STUN when the provider errors", async () => {
    global.fetch = jest.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const body = await (await GET(req())).json();
    expect(body.relay).toBe(false);
    errorSpy.mockRestore();
  });

  it("treats an empty server list as a failure, not a success", async () => {
    // A 200 carrying nothing would otherwise hand the peer connection an empty
    // iceServers array — worse than the STUN fallback it replaced.
    global.fetch = jest.fn(async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const body = await (await GET(req())).json();
    expect(body.iceServers.length).toBeGreaterThan(0);
    expect(body.relay).toBe(false);
    errorSpy.mockRestore();
  });
});

describe("hardening", () => {
  it("rate limits a caller hammering the endpoint", async () => {
    const ip = "203.0.113.9";
    let last = await GET(req("", ip));
    for (let i = 0; i < 40 && last.status !== 429; i++) last = await GET(req("", ip));
    expect(last.status).toBe(429);
    expect(last.headers.get("Retry-After")).toBeTruthy();
  });

  it("never lets a cache hold the credentials", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await GET(req());
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("answers a refusal identically whether the meeting exists or not", async () => {
    // The endpoint must not double as a way to discover live room codes.
    const missing = await GET(req("?roomCode=not-a-room&guestKey=g1"));
    const notAdmitted = await GET(req("?roomCode=abc-defg-hi&guestKey=g1"));
    expect(missing.status).toBe(notAdmitted.status);
    expect(await missing.json()).toEqual(await notAdmitted.json());
  });
});
