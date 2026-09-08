// Host admit/deny for the waiting room. Only the meeting's host (in their org)
// may decide; the write goes through the service role after that check.

const authMock = jest.fn();
const rlsFrom = jest.fn();
const writeCapture: {
  patch?: Record<string, unknown>;
  eqs: Array<[string, unknown]>;
  /** Rows the update reports back — the guests to be nudged. */
  decided: Array<{ guest_key: string }>;
  updateError: { message: string } | null;
} = { eqs: [], decided: [{ guest_key: "g1" }], updateError: null };

/** Channels published to, and what was sent on each. */
const broadcasts: Array<{ channel: string; event: string }> = [];
let broadcastThrows = false;

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServerClient: async () => ({ from: (...a: unknown[]) => rlsFrom(...a) }),
  createServiceClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {
        update: (patch: Record<string, unknown>) => { writeCapture.patch = patch; return b; },
        eq: (col: string, val: unknown) => { writeCapture.eqs.push([col, val]); return b; },
        // PostgREST returns the updated rows when the write asks for them.
        select: async () => ({ data: writeCapture.decided, error: writeCapture.updateError }),
        then: (resolve: (v: unknown) => void) => resolve({ error: writeCapture.updateError }),
      };
      return b;
    },
    channel: (name: string) => ({
      httpSend: async (event: string) => {
        if (broadcastThrows) throw new Error("realtime unavailable");
        broadcasts.push({ channel: name, event });
        return "ok";
      },
    }),
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
  writeCapture.decided = [{ guest_key: "g1" }];
  writeCapture.updateError = null;
  broadcasts.length = 0;
  broadcastThrows = false;
  authMock.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "host1", role: "owner", email: "h@test" } });
  rlsFrom.mockImplementation(() => meetingBuilder({ id: "m1", host_id: "host1", room_code: "abc-defg-hi" }));
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
    rlsFrom.mockImplementation(() => meetingBuilder({ id: "m1", host_id: "someone-else", room_code: "abc-defg-hi" }));
    const res = await POST(req({ decision: "admit", admissionId: "a1" }), params);
    expect(res.status).toBe(403);
  });

  it("propagates the auth failure status", async () => {
    authMock.mockResolvedValue({ ok: false, error: "No org", status: 403 });
    const res = await POST(req({ decision: "admit", admissionId: "a1" }), params);
    expect(res.status).toBe(403);
  });
});

// A decision the guest is not told about is a decision they wait out. The push
// is what makes the waiting room feel immediate; the poll behind it is only a
// safety net.
describe("telling the guest", () => {
  it("nudges the admitted guest on their own channel", async () => {
    await POST(req({ decision: "admit", admissionId: "a1" }), params);
    expect(broadcasts).toEqual([{ channel: "admission:abc-defg-hi:g1", event: "admission" }]);
  });

  it("nudges a denied guest too", async () => {
    await POST(req({ decision: "deny", admissionId: "a1" }), params);
    expect(broadcasts).toHaveLength(1);
  });

  it("nudges everyone that 'admit all' actually decided", async () => {
    writeCapture.decided = [{ guest_key: "g1" }, { guest_key: "g2" }, { guest_key: "g3" }];
    await POST(req({ decision: "admit", all: true }), params);
    expect(broadcasts.map((b) => b.channel)).toEqual([
      "admission:abc-defg-hi:g1",
      "admission:abc-defg-hi:g2",
      "admission:abc-defg-hi:g3",
    ]);
  });

  // The channel is per guest so that nobody else learns another guest's key —
  // a key is enough to read that guest's status from the poll endpoint.
  it("never puts a guest key on a channel another guest is listening to", async () => {
    writeCapture.decided = [{ guest_key: "g1" }, { guest_key: "g2" }];
    await POST(req({ decision: "admit", all: true }), params);
    for (const b of broadcasts) {
      const others = ["g1", "g2"].filter((k) => !b.channel.endsWith(`:${k}`));
      for (const other of others) expect(b.channel).not.toContain(other);
    }
  });

  it("says nothing when the decision matched nobody", async () => {
    writeCapture.decided = [];
    const res = await POST(req({ decision: "admit", admissionId: "gone" }), params);
    expect(res.status).toBe(200);
    expect(broadcasts).toHaveLength(0);
  });

  // The decision is already stored. Failing the host's admit because a
  // notification could not be delivered would be the worse outcome by far.
  it("still succeeds when the nudge cannot be delivered", async () => {
    broadcastThrows = true;
    const res = await POST(req({ decision: "admit", admissionId: "a1" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, decided: 1 });
  });

  it("does not nudge when the write itself failed", async () => {
    writeCapture.updateError = { message: "nope" };
    const res = await POST(req({ decision: "admit", admissionId: "a1" }), params);
    expect(res.status).toBe(500);
    expect(broadcasts).toHaveLength(0);
  });
});
