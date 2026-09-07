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

function postReq(body: unknown) {
  return new NextRequest("http://localhost/api/meetings/public/abc-defg-hi/knock", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  updateCapture.patch = undefined;
  tablesHit.length = 0;
  getUser.mockResolvedValue({ data: { user: null } });
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
