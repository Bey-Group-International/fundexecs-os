// Waiting-room knock/poll for guests. Knocking must be idempotent (an existing
// decision is returned, never reset), resolve the meeting via the service role
// so unauthenticated invite-link guests can knock, and AUTO-ADMIT signed-in org
// teammates so only external guests actually wait.

const from = jest.fn();
const getUser = jest.fn(async () => ({ data: { user: null as { id: string } | null } }));

/**
 * `after` runs its callback here and now.
 *
 * The real one needs a request scope this unit test has no way to build. What
 * matters to these tests is that the work is registered and runs at all —
 * which is the whole reason it is `after` and not a bare `void`: in a
 * serverless handler the runtime may freeze anything still pending the moment
 * the response goes out.
 */
jest.mock("next/server", () => {
  const actual = jest.requireActual("next/server");
  return { ...actual, after: (fn: () => unknown) => { void fn(); } };
});
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({ from: (...a: unknown[]) => from(...a) }),
  createServerClient: async () => ({ from: (...a: unknown[]) => from(...a), auth: { getUser: () => getUser() } }),
}));

import { NextRequest } from "next/server";
import { clearRateLimitBucketsForTests } from "@/lib/rate-limit";
import { POST, GET, DELETE } from "./route";
import { PRESENCE_WRITE_MS } from "@/lib/meetings/waiting-room";

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
const insertCapture: { row?: Record<string, unknown> } = {};
function admissionsBuilder({ existing, inserted }: { existing?: unknown; inserted?: unknown }) {
  let inserting = false;
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b, is: () => b, order: () => b,
    insert: (row: Record<string, unknown>) => { inserting = true; insertCapture.row = row; return b; },
    update: (patch: Record<string, unknown>) => { updateCapture.patch = patch; return b; },
    maybeSingle: async () => ({ data: inserting ? inserted ?? null : existing ?? null, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ error: null }),
  };
  return b;
}

/**
 * The admissions table as it behaves when two knocks for the same guest are in
 * flight: the first select finds nothing, the insert loses to UNIQUE
 * (meeting_id, guest_key), and the select after it finds the winner.
 *
 * The select counter is passed in rather than held per builder, because the
 * route reaches for `from("live_meeting_admissions")` afresh each time and the
 * whole point is what the SECOND read sees.
 *
 * `insertError` is a raw Postgres error rather than a shaped one, because the
 * route has to read the code off whatever supabase-js hands it.
 */
function racingAdmissionsBuilder(
  winner: unknown,
  insertError: { code?: string },
  reads: { count: number },
) {
  const b: Record<string, unknown> = {
    eq: () => b, is: () => b, order: () => b,
    select: () => b,
    update: (patch: Record<string, unknown>) => { updateCapture.patch = patch; return b; },
    insert: () => {
      const ins: Record<string, unknown> = {
        select: () => ins,
        maybeSingle: async () => ({ data: null, error: insertError }),
      };
      return ins;
    },
    maybeSingle: async () => {
      reads.count += 1;
      // The first read is the one that saw nothing and led to the insert.
      return { data: reads.count === 1 ? null : winner, error: null };
    },
  };
  return b;
}

/** Tables touched, in order — so a test can assert how many round trips a poll costs. */
const tablesHit: string[] = [];

/** The removals table: a plain awaited select, no maybeSingle. */
function removalsBuilder(rows: unknown[]) {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
  };
  return b;
}

function wire(
  meeting: unknown,
  admissions: { existing?: unknown; inserted?: unknown } = {},
  member: unknown = null,
  removals: unknown[] = [],
) {
  from.mockImplementation((table: string) => {
    tablesHit.push(table);
    if (table === "live_meetings") return meetingBuilder(meeting);
    if (table === "organization_members") return memberBuilder(member);
    if (table === "live_meeting_removals") return removalsBuilder(removals);
    return admissionsBuilder(admissions);
  });
}

/** Like `wire`, but the admissions table loses an insert race. */
function wireRace(
  meeting: unknown,
  winner: unknown,
  member: unknown = null,
  insertError: { code?: string } = { code: "23505" },
) {
  const reads = { count: 0 };
  from.mockImplementation((table: string) => {
    tablesHit.push(table);
    if (table === "live_meetings") return meetingBuilder(meeting);
    if (table === "organization_members") return memberBuilder(member);
    return racingAdmissionsBuilder(winner, insertError, reads);
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
  insertCapture.row = undefined;
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

  // Read-then-insert is not atomic, and this endpoint is called concurrently by
  // design: the guest's first knock races the re-knock their poll fires when the
  // server has no record of them. The loser used to be answered with a 500 —
  // turning the one operation documented as idempotent into a failure precisely
  // when it was repeated.
  it("answers a knock that lost the insert race with the row that won", async () => {
    wireRace(meeting, { id: "a1", status: "waiting", display_name: "Ada" });
    const res = await POST(postReq({ guestKey: "g1", displayName: "Ada" }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ admissionId: "a1", status: "waiting" });
  });

  it("does not undo a decision that landed while the knock was racing", async () => {
    wireRace(meeting, { id: "a1", status: "denied", display_name: "Ada" });
    const res = await POST(postReq({ guestKey: "g1", displayName: "Ada" }), params());
    expect(await res.json()).toEqual({ admissionId: "a1", status: "denied" });
  });

  // The promotion a teammate is owed has to survive the race too, or a member
  // whose two knocks collided would be left waiting on a host who is told
  // nothing is wrong.
  it("still promotes a teammate whose knock lost the race", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    wireRace(meeting, { id: "a1", status: "waiting", display_name: "Mel" }, { organization_id: "org1" });
    const res = await POST(postReq({ guestKey: "g1", displayName: "Mel" }), params());
    expect(await res.json()).toEqual({ admissionId: "a1", status: "admitted" });
    expect(updateCapture.patch).toMatchObject({ status: "admitted" });
  });

  // The control: only a unique violation means "somebody else got there first".
  // Every other insert failure is still a failure, and must not be dressed up as
  // a knock that worked.
  it("still reports a genuine insert failure", async () => {
    wireRace(meeting, { id: "a1", status: "waiting", display_name: "Ada" }, null, { code: "42501" });
    const res = await POST(postReq({ guestKey: "g1", displayName: "Ada" }), params());
    expect(res.status).toBe(500);
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
  const joined = (status: string, meetingStatus = "active", lastSeenAt: string | null = null) => ({
    id: "a1",
    status,
    last_seen_at: lastSeenAt,
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
  // the common case must not pay for a meeting lookup it does not need. The
  // claim is about THAT lookup: the joined read answers the status on its own.
  it("costs no meeting lookup when the guest has a knock on file", async () => {
    wire({ id: "m1", organization_id: "org1", status: "active" }, { existing: joined("waiting") });
    await GET(getReq(), params());
    expect(tablesHit).not.toContain("live_meetings");
  });

  // ── Presence ──────────────────────────────────────────────────────────────
  //
  // The poll is the only proof anybody has that a waiting guest is still there,
  // and it used to be thrown away. Recording it is what stops a guest who
  // knocked and closed the tab sitting in the host's panel all meeting.

  it("records a first sighting for a guest with no presence yet", async () => {
    wire({ id: "m1", organization_id: "org1", status: "active" }, { existing: joined("waiting") });
    await GET(getReq(), params());
    expect(updateCapture.patch).toMatchObject({ last_seen_at: expect.any(String) });
  });

  // Throttled hard. Unthrottled this is an UPDATE every 1.5s per waiting guest
  // — and, because the table is published to Realtime and the host subscribes
  // to `*` on it, a re-apply and a coalesced re-read on the host's screen at
  // the same rate.
  it("does not write again on the next tick", async () => {
    const justNow = new Date().toISOString();
    wire({ id: "m1", organization_id: "org1", status: "active" }, { existing: joined("waiting", "active", justNow) });
    await GET(getReq(), params());
    expect(updateCapture.patch).toBeUndefined();
    expect(tablesHit).toEqual(["live_meeting_admissions"]);
  });

  it("writes again once the record has gone stale", async () => {
    const old = new Date(Date.now() - PRESENCE_WRITE_MS - 1_000).toISOString();
    wire({ id: "m1", organization_id: "org1", status: "active" }, { existing: joined("waiting", "active", old) });
    await GET(getReq(), params());
    expect(updateCapture.patch).toMatchObject({ last_seen_at: expect.any(String) });
  });

  // A decided guest is not waiting for anything, and this is the hottest read
  // in the meeting stack.
  it("does not record presence for a guest who already has their answer", async () => {
    wire({ id: "m1", organization_id: "org1", status: "active" }, { existing: joined("admitted") });
    await GET(getReq(), params());
    expect(updateCapture.patch).toBeUndefined();
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

// ── Removal ─────────────────────────────────────────────────────────────────
//
// Removing somebody used to write nothing at all: the host's client broadcast a
// "kick" and closed its own peer connection, so the removal lasted exactly as
// long as it took the person to press reload. This is the door being shut.

describe("a removed person knocking again", () => {
  const meeting = { id: "m1", organization_id: "org1", status: "active" };
  const quickAccess = { ...meeting, guest_quick_access: true };

  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: null } });
  });

  it("refuses a removed guest by their key", async () => {
    wire(meeting, { existing: null, inserted: { id: "a1", status: "waiting" } }, null, [
      { user_id: null, guest_key: "g1" },
    ]);
    const res = await POST(postReq({ guestKey: "g1", displayName: "Mal" }), params());
    expect(await res.json()).toEqual({ status: "denied" });
  });

  it("leaves everybody else alone", async () => {
    wire(meeting, { existing: null, inserted: { id: "a2", status: "waiting" } }, null, [
      { user_id: null, guest_key: "someone-else" },
    ]);
    const res = await POST(postReq({ guestKey: "g1", displayName: "Ada" }), params());
    expect(await res.json()).toEqual({ admissionId: "a2", status: "waiting" });
  });

  // The reason a removal is keyed on the account for anyone who has one: org
  // membership is what waves a teammate past the waiting room, so a removal
  // that did not outrank it would not touch them at all.
  it("refuses a removed teammate, ahead of their membership", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    wire(meeting, { existing: null, inserted: { id: "a1", status: "admitted" } }, { organization_id: "org1" }, [
      { user_id: "u1", guest_key: null },
    ]);
    const res = await POST(postReq({ guestKey: "g1", displayName: "Sam" }), params());
    expect(await res.json()).toEqual({ status: "denied" });
  });

  // And the thing keying on the account actually buys: clearing site data
  // mints a brand new guest key, and changes nothing.
  it("refuses a removed teammate who arrives with a fresh guest key", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    wire(meeting, { existing: null, inserted: { id: "a1", status: "admitted" } }, { organization_id: "org1" }, [
      { user_id: "u1", guest_key: null },
    ]);
    const res = await POST(postReq({ guestKey: "brand-new-key", displayName: "Sam" }), params());
    expect(await res.json()).toEqual({ status: "denied" });
  });

  // Quick access is the other way past the queue, and it used to skip resolving
  // the caller entirely — so a removal on a quick-access meeting would have
  // lasted until the person pressed reload.
  it("refuses a removed guest even when quick access is on", async () => {
    wire(quickAccess, { existing: null, inserted: { id: "a1", status: "admitted" } }, null, [
      { user_id: null, guest_key: "g1" },
    ]);
    const res = await POST(postReq({ guestKey: "g1", displayName: "Mal" }), params());
    expect(await res.json()).toEqual({ status: "denied" });
  });

  // An existing admitted row is the exact path a removed guest's reload took
  // back into the call: the knock is idempotent and returned the old decision.
  it("refuses before honouring a knock already on file", async () => {
    wire(meeting, { existing: { id: "a1", status: "admitted", display_name: "Mal" } }, null, [
      { user_id: null, guest_key: "g1" },
    ]);
    const res = await POST(postReq({ guestKey: "g1", displayName: "Mal" }), params());
    expect(await res.json()).toEqual({ status: "denied" });
  });
});

// The column that has existed since the waiting room shipped and has been NULL
// on every row ever written. The knock route resolved the caller's account to
// decide whether they were a teammate, and then threw it away — so the one
// table that knew a signed-in person had knocked could not say who.
describe("the account on a knock", () => {
  const meeting = { id: "m1", organization_id: "org1", status: "active" };

  it("records the account a signed-in caller knocked with", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    wire(meeting, { existing: null, inserted: { id: "a1", status: "waiting" } });
    await POST(postReq({ guestKey: "g1", displayName: "Sam" }), params());
    expect(insertCapture.row).toMatchObject({ user_id: "u1", guest_key: "g1" });
  });

  it("leaves it null for an invite-link guest, who has no account", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    wire(meeting, { existing: null, inserted: { id: "a1", status: "waiting" } });
    await POST(postReq({ guestKey: "g1", displayName: "Ada" }), params());
    expect(insertCapture.row).toMatchObject({ user_id: null });
  });

  // A row written before this column was populated, or one whose first knock
  // landed before its owner had signed in, is a row a later removal could not
  // match. Backfilled on the way past rather than left to rot.
  it("backfills the account on a knock already on file", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    wire(meeting, { existing: { id: "a1", status: "waiting", display_name: "Sam" } }, { organization_id: "org1" });
    await POST(postReq({ guestKey: "g1", displayName: "Sam" }), params());
    expect(updateCapture.patch).toMatchObject({ status: "admitted", user_id: "u1" });
  });
});

// ── Withdrawing a knock ─────────────────────────────────────────────────────
//
// A guest who gave up used to leave their row behind forever: cancelling was
// entirely local, there is no TTL on the table and nothing sweeps it. The host
// went on seeing somebody who had left, and admitting them reached nobody.

/** Captures what a delete was filtered by, so the guard can be asserted. */
function withdrawBuilder(removed: unknown[]) {
  const filters: Array<[string, unknown]> = [];
  let deleting = false;
  const b: Record<string, unknown> = {
    select: async () => (deleting ? { data: removed, error: null } : { data: null, error: null }),
    delete: () => { deleting = true; return b; },
    eq: (col: string, val: unknown) => { filters.push([col, val]); return b; },
    is: () => b,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return { b, filters };
}

function withdrawReq(key = "g-1") {
  return new NextRequest(`http://x/api/meetings/public/abc-defg-hi/knock?key=${key}`, { method: "DELETE" });
}

describe("DELETE — withdrawing a knock", () => {
  beforeEach(() => { clearRateLimitBucketsForTests(); from.mockReset(); });

  it("removes this guest's pending row and says how many it took", async () => {
    const w = withdrawBuilder([{ id: "a1" }]);
    from.mockImplementation((table: string) =>
      table === "live_meetings" ? meetingBuilder({ id: "m1", organization_id: "o1", status: "live" }) : w.b);

    const res = await DELETE(withdrawReq(), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, withdrawn: 1 });
  });

  // The guard that makes this safe to expose unauthenticated. A decided row is
  // not the caller's to erase: an admit is what the transcript route checks a
  // guest's own writes against, and a deny must not be undoable by withdrawing.
  it("only ever touches a row that is still waiting, in this meeting, for this key", async () => {
    const w = withdrawBuilder([]);
    from.mockImplementation((table: string) =>
      table === "live_meetings" ? meetingBuilder({ id: "m1", organization_id: "o1", status: "live" }) : w.b);

    await DELETE(withdrawReq("g-9"), params());
    expect(w.filters).toEqual([
      ["meeting_id", "m1"],
      ["guest_key", "g-9"],
      ["status", "waiting"],
    ]);
  });

  it("needs a key", async () => {
    const res = await DELETE(
      new NextRequest("http://x/api/meetings/public/abc-defg-hi/knock", { method: "DELETE" }),
      params(),
    );
    expect(res.status).toBe(400);
  });

  // Nothing to withdraw from, and nothing the guest can do about it — they are
  // walking away from this screen either way.
  it("is quiet about a meeting that is not there", async () => {
    from.mockImplementation(() => meetingBuilder(null));
    const res = await DELETE(withdrawReq(), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, withdrawn: 0 });
  });

  it("is bounded like the knock it withdraws", async () => {
    const w = withdrawBuilder([]);
    from.mockImplementation((table: string) =>
      table === "live_meetings" ? meetingBuilder({ id: "m1", organization_id: "o1", status: "live" }) : w.b);

    let last = await DELETE(withdrawReq(), params());
    for (let i = 0; i < 70 && last.status !== 429; i += 1) last = await DELETE(withdrawReq(), params());
    expect(last.status).toBe(429);
    expect(last.headers.get("Retry-After")).toBeTruthy();
  });
});
