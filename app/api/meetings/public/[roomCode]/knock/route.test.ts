// Waiting-room knock/poll for guests. Knocking must be idempotent (an existing
// decision is returned, never reset), resolve the meeting via the service role
// so unauthenticated invite-link guests can knock, and AUTO-ADMIT signed-in org
// teammates so only external guests actually wait.

const from = jest.fn();
const getUser = jest.fn(async () => ({ data: { user: null as { id: string } | null } }));
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({ from: (...a: unknown[]) => from(...a) }),
  createServerClient: async () => ({ from: (...a: unknown[]) => from(...a), auth: { getUser: () => getUser() } }),
}));

import { NextRequest } from "next/server";
import { clearRateLimitBucketsForTests } from "@/lib/rate-limit";
import { POST, GET } from "./route";

const params = (roomCode = "abc-defg-hi") => ({ params: Promise.resolve({ roomCode }) });

function meetingBuilder(meeting: unknown) {
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b, is: () => b,
    maybeSingle: async () => ({ data: meeting, error: null }),
  };
  return b;
}

function memberBuilder(member: unknown) {
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b,
    maybeSingle: async () => ({ data: member ?? null, error: null }),
  };
  return b;
}

const updateCapture: { patch?: Record<string, unknown> } = {};
function admissionsBuilder({ existing, inserted }: { existing?: unknown; inserted?: unknown }) {
  let inserting = false;
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b, is: () => b, order: () => b,
    insert: () => { inserting = true; return b; },
    update: (patch: Record<string, unknown>) => { updateCapture.patch = patch; return b; },
    maybeSingle: async () => ({ data: inserting ? inserted ?? null : existing ?? null, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  };
  return b;
}

/** Tables touched, in order — so a test can assert how many round trips a poll costs. */
const tablesHit: string[] = [];

function wire(
  meeting: unknown,
  admissions: { existing?: unknown; inserted?: unknown } = {},
  member: unknown = null,
) {
  from.mockImplementation((table: string) => {
    tablesHit.push(table);
    if (table === "live_meetings") return meetingBuilder(meeting);
    if (table === "organization_members") return memberBuilder(member);
    return admissionsBuilder(admissions);
  });
}

function postReq(body: unknown, ip = "198.51.100.7") {
  return new NextRequest("http://localhost/api/meetings/public/abc-defg-hi/knock", {
    method: "POST",
    body: JSON.stringify(body),
    // Set at the edge and stripped from anything the client sends, which is why
    // clientIp reads this one first — see lib/rate-limit.ts.
    headers: { "x-vercel-forwarded-for": ip },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  updateCapture.patch = undefined;
  tablesHit.length = 0;
  getUser.mockResolvedValue({ data: { user: null } });
  // The limiter's buckets are module state. Cleared between tests so one test's
  // knocks cannot spend another's allowance and the order stops mattering.
  clearRateLimitBucketsForTests();
});

describe("POST knock", () => {
  const meeting = { id: "m1", organization_id: "org1", status: "waiting" };

  it("inserts a waiting knock for an external guest", async () => {
    wire(meeting, { existing: null, inserted: { id: "a1", status: "waiting" } });
    const res = await POST(postReq({ guestKey: "g1", displayName: "Ada" }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admissionId: "a1", status: "waiting" });
  });

  it("auto-admits a signed-in org teammate", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    wire(meeting, { existing: null, inserted: { id: "a1", status: "admitted" } }, { organization_id: "org1" });
    const res = await POST(postReq({ guestKey: "g1", displayName: "Ada" }), params());
    expect(await res.json()).toEqual({ admissionId: "a1", status: "admitted" });
  });

  it("does NOT auto-admit a signed-in user from another org", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u9" } } });
    // Not a member of org1 → memberBuilder returns null → waits.
    wire(meeting, { existing: null, inserted: { id: "a1", status: "waiting" } }, null);
    const res = await POST(postReq({ guestKey: "g1" }), params());
    expect(await res.json()).toEqual({ admissionId: "a1", status: "waiting" });
  });

  it("promotes a teammate who is already waiting", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    wire(meeting, { existing: { id: "a1", status: "waiting" } }, { organization_id: "org1" });
    const res = await POST(postReq({ guestKey: "g1" }), params());
    expect(await res.json()).toEqual({ admissionId: "a1", status: "admitted" });
    expect(updateCapture.patch?.status).toBe("admitted");
  });

  it("returns an existing decision without re-inserting (idempotent)", async () => {
    wire(meeting, { existing: { id: "a1", status: "admitted" } });
    const res = await POST(postReq({ guestKey: "g1", displayName: "Ada" }), params());
    expect(await res.json()).toEqual({ admissionId: "a1", status: "admitted" });
  });

  // Guests are keyed by a persisted guest_key now, so a re-knock lands on the
  // same row. The host decides on a name, so a pending row should carry the one
  // the guest is currently offering.
  it("refreshes the display name on a still-pending re-knock", async () => {
    wire(meeting, { existing: { id: "a1", status: "waiting", display_name: "Guest" } });
    const res = await POST(postReq({ guestKey: "g1", displayName: "Ada Lovelace" }), params());
    expect(await res.json()).toEqual({ admissionId: "a1", status: "waiting" });
    expect(updateCapture.patch).toEqual({ display_name: "Ada Lovelace" });
  });

  it("leaves the name alone when it hasn't changed", async () => {
    wire(meeting, { existing: { id: "a1", status: "waiting", display_name: "Ada" } });
    await POST(postReq({ guestKey: "g1", displayName: "Ada" }), params());
    expect(updateCapture.patch).toBeUndefined();
  });

  // A decision was made about a specific name; a later knock must not quietly
  // relabel a row the host has already ruled on.
  it("does not rewrite the name on an already-decided row", async () => {
    wire(meeting, { existing: { id: "a1", status: "denied", display_name: "Ada" } });
    const res = await POST(postReq({ guestKey: "g1", displayName: "Someone Else" }), params());
    expect(await res.json()).toEqual({ admissionId: "a1", status: "denied" });
    expect(updateCapture.patch).toBeUndefined();
  });

  // The whole point of a persisted guest key: a refresh must not undo a deny.
  it("keeps denying a guest who knocks again under the same key", async () => {
    wire(meeting, { existing: { id: "a1", status: "denied", display_name: "Ada" } });
    const res = await POST(postReq({ guestKey: "g1", displayName: "Ada" }), params());
    expect(await res.json()).toEqual({ admissionId: "a1", status: "denied" });
  });

  // Quick access — a per-meeting opt-out of the waiting room. The default
  // (absent/false) must keep every existing meeting knocking, and the flag must
  // only ever be believed from the meeting row, never from the guest's request.
  it("admits an external guest immediately when quick access is on", async () => {
    wire(
      { ...meeting, guest_quick_access: true },
      { existing: null, inserted: { id: "a1", status: "admitted" } },
    );
    const res = await POST(postReq({ guestKey: "g1", displayName: "Ana" }), params());
    expect(await res.json()).toEqual({ admissionId: "a1", status: "admitted" });
    // Never asks who the caller is: holding the link is the whole check.
    expect(tablesHit).not.toContain("organization_members");
  });

  it("still makes guests wait when quick access is off or absent", async () => {
    for (const row of [{ ...meeting, guest_quick_access: false }, meeting]) {
      tablesHit.length = 0;
      wire(row, { existing: null, inserted: { id: "a1", status: "waiting" } });
      const res = await POST(postReq({ guestKey: "g1" }), params());
      expect(await res.json()).toEqual({ admissionId: "a1", status: "waiting" });
    }
  });

  it("releases a guest already in the queue when quick access is switched on", async () => {
    wire({ ...meeting, guest_quick_access: true }, { existing: { id: "a1", status: "waiting" } });
    const res = await POST(postReq({ guestKey: "g1" }), params());
    expect(await res.json()).toEqual({ admissionId: "a1", status: "admitted" });
    expect(updateCapture.patch).toMatchObject({ status: "admitted" });
  });

  it("cannot be turned on by the guest's own request body", async () => {
    wire(meeting, { existing: null, inserted: { id: "a1", status: "waiting" } });
    const res = await POST(
      postReq({ guestKey: "g1", guestQuickAccess: true, guest_quick_access: true, status: "admitted" }),
      params(),
    );
    expect(await res.json()).toEqual({ admissionId: "a1", status: "waiting" });
  });

  it("does not let quick access override an explicit denial", async () => {
    wire({ ...meeting, guest_quick_access: true }, { existing: { id: "a1", status: "denied" } });
    const res = await POST(postReq({ guestKey: "g1" }), params());
    expect(await res.json()).toEqual({ admissionId: "a1", status: "denied" });
  });

  it("400s without a guestKey", async () => {
    wire(meeting);
    const res = await POST(postReq({ displayName: "Ada" }), params());
    expect(res.status).toBe(400);
  });

  it("404s when the meeting doesn't exist", async () => {
    wire(null);
    const res = await POST(postReq({ guestKey: "g1" }), params());
    expect(res.status).toBe(404);
  });

  it("reports an ended meeting", async () => {
    wire({ id: "m1", organization_id: "org1", status: "ended" });
    const res = await POST(postReq({ guestKey: "g1" }), params());
    expect(await res.json()).toEqual({ status: "ended" });
  });
});

describe("GET poll", () => {
  function getReq(key = "g1") {
    return new NextRequest(`http://localhost/api/meetings/public/abc-defg-hi/knock?key=${key}`);
  }

  /** The joined shape the fast path selects: the admission with its meeting embedded. */
  const joined = (status: string, meetingStatus = "active") => ({
    status,
    live_meetings: { status: meetingStatus, room_code: "abc-defg-hi", deleted_at: null },
  });

  it("returns the current status for a knock", async () => {
    wire({ id: "m1", organization_id: "org1", status: "active" }, { existing: joined("admitted") });
    const res = await GET(getReq(), params());
    expect(await res.json()).toEqual({ status: "admitted" });
  });

  it("returns waiting while the host has not decided", async () => {
    wire({ id: "m1", organization_id: "org1", status: "active" }, { existing: joined("waiting") });
    expect(await (await GET(getReq(), params())).json()).toEqual({ status: "waiting" });
  });

  it("returns denied so the guest stops waiting", async () => {
    wire({ id: "m1", organization_id: "org1", status: "active" }, { existing: joined("denied") });
    expect(await (await GET(getReq(), params())).json()).toEqual({ status: "denied" });
  });

  // This endpoint is polled by every waiting guest for as long as they wait, so
  // the common case must not pay for a meeting lookup it does not need.
  it("costs a single query when the guest has a knock on file", async () => {
    wire({ id: "m1", organization_id: "org1", status: "active" }, { existing: joined("waiting") });
    await GET(getReq(), params());
    expect(tablesHit).toEqual(["live_meeting_admissions"]);
  });

  it("reports an ended meeting from the joined row, without a second query", async () => {
    wire({ id: "m1", organization_id: "org1", status: "ended" }, { existing: joined("waiting", "ended") });
    const res = await GET(getReq(), params());
    expect(await res.json()).toEqual({ status: "ended" });
    expect(tablesHit).toEqual(["live_meeting_admissions"]);
  });

  // No knock on file is the one case worth a second query: the client re-knocks
  // on "unknown" and gives up on a 404, so the two must not be conflated.
  it("returns unknown when there's no knock yet, for a meeting that exists", async () => {
    wire({ id: "m1", organization_id: "org1", status: "active" }, { existing: null });
    const res = await GET(getReq(), params());
    expect(await res.json()).toEqual({ status: "unknown" });
    expect(tablesHit).toEqual(["live_meeting_admissions", "live_meetings"]);
  });

  it("404s when there's no knock because there's no meeting", async () => {
    wire(null, { existing: null });
    const res = await GET(getReq(), params());
    expect(res.status).toBe(404);
  });

  it("reports an ended meeting even with no knock on file", async () => {
    wire({ id: "m1", organization_id: "org1", status: "ended" }, { existing: null });
    expect(await (await GET(getReq(), params())).json()).toEqual({ status: "ended" });
  });

  it("400s without a key", async () => {
    wire({ id: "m1", organization_id: "org1", status: "active" });
    const res = await GET(new NextRequest("http://localhost/api/meetings/public/abc/knock"), params());
    expect(res.status).toBe(400);
  });

  // Defensive: a to-one embed is an object, but an array must not make the
  // ended check silently stop firing and strand a guest on a finished meeting.
  it("reads the embedded meeting whether it arrives as an object or an array", async () => {
    wire({ id: "m1", organization_id: "org1", status: "ended" }, {
      existing: { status: "waiting", live_meetings: [{ status: "ended", room_code: "abc-defg-hi", deleted_at: null }] },
    });
    expect(await (await GET(getReq(), params())).json()).toEqual({ status: "ended" });
  });
});

// Both halves of this endpoint are unauthenticated and reachable by anyone who
// was ever forwarded an invite link. The POST is the one with teeth: it inserts
// a row under a guest_key the CALLER chooses, so nothing in the row collapses a
// flood — an unbounded POST is an unbounded waiting list, in a panel a host is
// reading during a live meeting.
describe("rate limiting", () => {
  const meeting = { id: "m1", organization_id: "org1", status: "waiting" };

  function pollReq(ip = "198.51.100.7") {
    return new NextRequest("http://localhost/api/meetings/public/abc-defg-hi/knock?key=g1", {
      headers: { "x-vercel-forwarded-for": ip },
    });
  }

  it("refuses a flood of knocks from one address", async () => {
    wire(meeting, { existing: null, inserted: { id: "a1", status: "waiting" } });
    let refused: Response | null = null;
    for (let i = 0; i < 200; i++) {
      const res = await POST(postReq({ guestKey: `g${i}` }), params());
      if (res.status === 429) { refused = res; break; }
    }
    expect(refused).not.toBeNull();
    expect(refused!.headers.get("Retry-After")).toBeTruthy();
  });

  // Stops before the database, not after it: a limiter that answered 429 having
  // already written the row would be bounding the response and nothing else.
  it("refuses before touching the database", async () => {
    wire(meeting, { existing: null, inserted: { id: "a1", status: "waiting" } });
    for (let i = 0; i < 200; i++) {
      const res = await POST(postReq({ guestKey: `g${i}` }), params());
      if (res.status === 429) break;
    }
    const before = tablesHit.length;
    const res = await POST(postReq({ guestKey: "one-more" }), params());
    expect(res.status).toBe(429);
    expect(tablesHit.length).toBe(before);
  });

  // An office behind one NAT is a real thing; a limiter keyed on the address
  // must not let one busy building lock out another.
  it("counts each address separately", async () => {
    wire(meeting, { existing: null, inserted: { id: "a1", status: "waiting" } });
    for (let i = 0; i < 200; i++) {
      const res = await POST(postReq({ guestKey: `g${i}` }, "203.0.113.1"), params());
      if (res.status === 429) break;
    }
    const other = await POST(postReq({ guestKey: "fresh" }, "203.0.113.2"), params());
    expect(other.status).toBe(200);
  });

  // The poll is a read, so it is bounded for load rather than for content — and
  // well clear of a real guest, who polls about 26 times in their first minute.
  it("lets a waiting guest poll at the cadence they actually poll at", async () => {
    wire(meeting, { existing: { status: "waiting", live_meetings: { status: "waiting" } } });
    for (let i = 0; i < 30; i++) {
      const res = await GET(pollReq(), params());
      expect(res.status).toBe(200);
    }
  });

  it("still refuses a poll that is not a guest waiting", async () => {
    wire(meeting, { existing: { status: "waiting", live_meetings: { status: "waiting" } } });
    let refused = false;
    for (let i = 0; i < 1200; i++) {
      const res = await GET(pollReq(), params());
      if (res.status === 429) { refused = true; break; }
    }
    expect(refused).toBe(true);
  });

  // A knock and a poll are bounded separately: sharing one bucket would mean a
  // guest who polls for two minutes cannot re-knock when told to.
  it("does not let polling spend the knock allowance", async () => {
    wire(meeting, { existing: { status: "waiting", live_meetings: { status: "waiting" } } });
    for (let i = 0; i < 100; i++) await GET(pollReq(), params());
    wire(meeting, { existing: null, inserted: { id: "a1", status: "waiting" } });
    const res = await POST(postReq({ guestKey: "g1" }), params());
    expect(res.status).toBe(200);
  });
});
