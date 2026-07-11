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

function wire(
  meeting: unknown,
  admissions: { existing?: unknown; inserted?: unknown } = {},
  member: unknown = null,
) {
  from.mockImplementation((table: string) => {
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

  it("returns the current status for a knock", async () => {
    wire({ id: "m1", organization_id: "org1", status: "waiting" }, { existing: { status: "admitted" } });
    const res = await GET(getReq(), params());
    expect(await res.json()).toEqual({ status: "admitted" });
  });

  it("returns unknown when there's no knock yet", async () => {
    wire({ id: "m1", organization_id: "org1", status: "waiting" }, { existing: null });
    const res = await GET(getReq(), params());
    expect(await res.json()).toEqual({ status: "unknown" });
  });

  it("400s without a key", async () => {
    wire({ id: "m1", organization_id: "org1", status: "waiting" });
    const res = await GET(new NextRequest("http://localhost/api/meetings/public/abc/knock"), params());
    expect(res.status).toBe(400);
  });
});
