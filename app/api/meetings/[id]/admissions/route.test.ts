// Host admit/deny for the waiting room. Only the meeting's host (in their org)
// may decide; the write goes through the service role after that check.

const authMock = jest.fn();
const rlsFrom = jest.fn();
const writeCapture: { patch?: Record<string, unknown>; eqs: Array<[string, unknown]> } = { eqs: [] };

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServerClient: async () => ({ from: (...a: unknown[]) => rlsFrom(...a) }),
  createServiceClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {
        update: (patch: Record<string, unknown>) => { writeCapture.patch = patch; return b; },
        eq: (col: string, val: unknown) => { writeCapture.eqs.push([col, val]); return b; },
        then: (resolve: (v: unknown) => void) => resolve({ error: null }),
      };
      return b;
    },
  }),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const params = { params: Promise.resolve({ id: "m1" }) };
function req(body: unknown) {
  return new NextRequest("http://localhost/api/meetings/m1/admissions", { method: "POST", body: JSON.stringify(body) });
}
function meetingBuilder(meeting: unknown) {
  const b: Record<string, unknown> = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: meeting, error: null }) };
  return b;
}

beforeEach(() => {
  jest.clearAllMocks();
  writeCapture.patch = undefined;
  writeCapture.eqs = [];
  authMock.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "host1", role: "owner", email: "h@test" } });
  rlsFrom.mockImplementation(() => meetingBuilder({ id: "m1", host_id: "host1" }));
});

describe("POST /api/meetings/[id]/admissions", () => {
  it("admits a specific knock", async () => {
    const res = await POST(req({ decision: "admit", admissionId: "a1" }), params);
    expect(res.status).toBe(200);
    expect(writeCapture.patch?.status).toBe("admitted");
    expect(writeCapture.eqs).toContainEqual(["meeting_id", "m1"]);
    expect(writeCapture.eqs).toContainEqual(["id", "a1"]);
  });

  it("admits everyone waiting with all:true", async () => {
    const res = await POST(req({ decision: "admit", all: true }), params);
    expect(res.status).toBe(200);
    expect(writeCapture.eqs).toContainEqual(["status", "waiting"]);
  });

  it("denies a specific knock", async () => {
    const res = await POST(req({ decision: "deny", admissionId: "a1" }), params);
    expect(res.status).toBe(200);
    expect(writeCapture.patch?.status).toBe("denied");
  });

  it("400s on a missing/invalid decision", async () => {
    const res = await POST(req({ admissionId: "a1" }), params);
    expect(res.status).toBe(400);
  });

  it("400s when neither admissionId nor all is provided", async () => {
    const res = await POST(req({ decision: "admit" }), params);
    expect(res.status).toBe(400);
  });

  it("404s when the meeting isn't in the caller's org", async () => {
    rlsFrom.mockImplementation(() => meetingBuilder(null));
    const res = await POST(req({ decision: "admit", admissionId: "a1" }), params);
    expect(res.status).toBe(404);
  });

  it("403s when the caller isn't the host", async () => {
    rlsFrom.mockImplementation(() => meetingBuilder({ id: "m1", host_id: "someone-else" }));
    const res = await POST(req({ decision: "admit", admissionId: "a1" }), params);
    expect(res.status).toBe(403);
  });

  it("propagates the auth failure status", async () => {
    authMock.mockResolvedValue({ ok: false, error: "No org", status: 403 });
    const res = await POST(req({ decision: "admit", admissionId: "a1" }), params);
    expect(res.status).toBe(403);
  });
});
