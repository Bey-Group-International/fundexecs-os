// Host removal. The half of "Remove" that used to not exist.
//
// Before this route, removing somebody was a broadcast and a local close: the
// host's own grid dropped them and nothing else changed anywhere. So the person
// stayed connected to every other participant, and a reload put them back on
// the host's screen too. These tests pin the three things that stop that — the
// row, the shut door, and the nudge — and the authority check around them.

const authMock = jest.fn();
const rlsFrom = jest.fn();

const writes: {
  upsert?: Record<string, unknown>;
  onConflict?: string;
  upsertError: { message: string } | null;
  /** The admission update, and what it matched on. */
  patch?: Record<string, unknown>;
  match?: Record<string, unknown>;
  denied: Array<{ guest_key: string }>;
  deleted: boolean;
  tables: string[];
} = { upsertError: null, denied: [], deleted: false, tables: [] };

const broadcasts: Array<{ channel: string; event: string }> = [];

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServerClient: async () => ({ from: (...a: unknown[]) => rlsFrom(...a) }),
  createServiceClient: () => ({
    from: (table: string) => {
      writes.tables.push(table);
      const b: Record<string, unknown> = {
        upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => {
          writes.upsert = row;
          writes.onConflict = opts?.onConflict;
          return b;
        },
        update: (patch: Record<string, unknown>) => { writes.patch = patch; return b; },
        delete: () => { writes.deleted = true; return b; },
        eq: () => b,
        match: (m: Record<string, unknown>) => { writes.match = m; return b; },
        select: async () => ({ data: writes.denied, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ error: writes.upsertError }),
      };
      return b;
    },
    channel: (name: string) => ({
      httpSend: async (event: string) => { broadcasts.push({ channel: name, event }); return "ok"; },
    }),
  }),
}));

import { NextRequest } from "next/server";
import { DELETE, POST } from "./route";
import { removalChannelName } from "@/lib/meetings/removal-channel";

const params = { params: Promise.resolve({ id: "m1" }) };
const req = (body: unknown, method = "POST") =>
  new NextRequest("http://localhost/api/meetings/m1/removals", { method, body: JSON.stringify(body) });

function meetingBuilder(meeting: unknown) {
  const b: Record<string, unknown> = {
    select: () => b, eq: () => b, maybeSingle: async () => ({ data: meeting, error: null }),
  };
  return b;
}

const MEETING = { id: "m1", host_id: "host-1", room_code: "abc-defg-hi", organization_id: "org1" };

beforeEach(() => {
  jest.clearAllMocks();
  writes.upsert = undefined;
  writes.onConflict = undefined;
  writes.upsertError = null;
  writes.patch = undefined;
  writes.match = undefined;
  writes.denied = [];
  writes.deleted = false;
  writes.tables = [];
  broadcasts.length = 0;
  authMock.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "host-1" } });
  rlsFrom.mockImplementation(() => meetingBuilder(MEETING));
});

describe("POST, who may remove somebody", () => {
  it("refuses a caller with no org context", async () => {
    authMock.mockResolvedValue({ ok: false, error: "Unauthorized", status: 401 });
    const res = await POST(req({ subject: { kind: "guest", guestKey: "g1" } }), params);
    expect(res.status).toBe(401);
  });

  // Removal is the host's authority, not the organisation's: a teammate in the
  // same org watching the meeting must not be able to eject people from it.
  it("refuses an org member who is not the host", async () => {
    authMock.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "someone-else" } });
    const res = await POST(req({ subject: { kind: "guest", guestKey: "g1" } }), params);
    expect(res.status).toBe(403);
    expect(writes.upsert).toBeUndefined();
  });

  it("404s for a meeting outside the caller's org", async () => {
    rlsFrom.mockImplementation(() => meetingBuilder(null));
    const res = await POST(req({ subject: { kind: "guest", guestKey: "g1" } }), params);
    expect(res.status).toBe(404);
  });

  // The door a removed person is refused at is the one the host controls, so a
  // host who removed themselves would be locked out of their own room.
  it("refuses a host removing themselves", async () => {
    const res = await POST(req({ subject: { kind: "member", userId: "host-1" } }), params);
    expect(res.status).toBe(400);
    expect(writes.upsert).toBeUndefined();
  });

  it("400s without a subject it can read", async () => {
    for (const body of [{}, { subject: "g1" }, { subject: { kind: "nobody" } }]) {
      expect((await POST(req(body), params)).status).toBe(400);
    }
    expect(writes.upsert).toBeUndefined();
  });
});

describe("POST, what a removal writes", () => {
  it("records a guest against their key", async () => {
    const res = await POST(req({ subject: { kind: "guest", guestKey: "g1" }, displayName: "Mal" }), params);
    expect(res.status).toBe(200);
    expect(writes.upsert).toMatchObject({
      meeting_id: "m1", organization_id: "org1",
      guest_key: "g1", user_id: null,
      display_name: "Mal", removed_by: "host-1",
    });
  });

  // A member is keyed on their account, because membership is what waves them
  // past the waiting room — a removal on their guest key would not touch them.
  it("records a member against their account", async () => {
    await POST(req({ subject: { kind: "member", userId: "u2" }, displayName: "Sam" }), params);
    expect(writes.upsert).toMatchObject({ user_id: "u2", guest_key: null });
    expect(writes.onConflict).toBe("meeting_id,user_id");
  });

  // Pressing Remove twice is one removal, and the second press must not error
  // at a host who is not sure the first one took.
  it("upserts on the identifier it used", async () => {
    await POST(req({ subject: { kind: "guest", guestKey: "g1" } }), params);
    expect(writes.onConflict).toBe("meeting_id,guest_key");
  });

  it("keeps a name even when none was offered", async () => {
    await POST(req({ subject: { kind: "guest", guestKey: "g1" } }), params);
    expect(writes.upsert).toMatchObject({ display_name: "Guest" });
  });

  // The row IS the operation here, unlike the nudges below. A host told the
  // removal worked when nothing was written would believe somebody was out of
  // the room who is still in it.
  it("fails loudly when the row cannot be written", async () => {
    writes.upsertError = { message: "constraint" };
    const res = await POST(req({ subject: { kind: "guest", guestKey: "g1" } }), params);
    expect(res.status).toBe(500);
  });
});

describe("POST, shutting the door and telling the room", () => {
  // The exact path a removed guest's reload took back in: the knock is
  // idempotent, so an admission still reading `admitted` let them straight
  // through.
  it("denies the admission they came in on", async () => {
    await POST(req({ subject: { kind: "guest", guestKey: "g1" } }), params);
    expect(writes.patch).toMatchObject({ status: "denied", decided_by: "host-1" });
    expect(writes.match).toEqual({ guest_key: "g1" });
  });

  it("matches a member's admission on their account", async () => {
    await POST(req({ subject: { kind: "member", userId: "u2" } }), params);
    expect(writes.match).toEqual({ user_id: "u2" });
  });

  // The defect this route exists for: a removal reached the host's own screen
  // and nobody else's, so the person kept streaming to every other participant.
  it("nudges the room so every participant drops them", async () => {
    await POST(req({ subject: { kind: "guest", guestKey: "g1" } }), params);
    expect(broadcasts.map((b) => b.channel)).toContain(removalChannelName("abc-defg-hi"));
  });

  it("nudges the guest whose admission it just denied", async () => {
    writes.denied = [{ guest_key: "g1" }];
    await POST(req({ subject: { kind: "guest", guestKey: "g1" } }), params);
    expect(broadcasts.map((b) => b.channel)).toContain("admission:abc-defg-hi:g1");
  });

  // Best-effort, exactly like the admissions route's: the removal is a fact
  // once the row is written, and every client re-reads on its own cadence.
  it("still succeeds when nothing can be published", async () => {
    const res = await POST(req({ subject: { kind: "guest", guestKey: "g1" } }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, removed: 1 });
  });
});

// A removal that could not be undone would be a worse trap than the one it
// replaced: before this change a misclick corrected itself the moment the
// person pressed reload.
describe("DELETE, letting somebody back in", () => {
  it("deletes the removal", async () => {
    const res = await DELETE(req({ subject: { kind: "guest", guestKey: "g1" } }, "DELETE"), params);
    expect(res.status).toBe(200);
    expect(writes.deleted).toBe(true);
    expect(writes.match).toEqual({ guest_key: "g1" });
    expect(writes.tables).toContain("live_meeting_removals");
  });

  it("lifts a member's removal by their account", async () => {
    await DELETE(req({ subject: { kind: "member", userId: "u2" } }, "DELETE"), params);
    expect(writes.match).toEqual({ user_id: "u2" });
  });

  // Undo is the same authority as the removal, so it answers to the same check.
  it("refuses anyone but the host", async () => {
    authMock.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "someone-else" } });
    const res = await DELETE(req({ subject: { kind: "guest", guestKey: "g1" } }, "DELETE"), params);
    expect(res.status).toBe(403);
    expect(writes.deleted).toBe(false);
  });

  // The admission stays denied on purpose: they knock again, and the host
  // decides at the door, where they can see who it is.
  it("does not re-admit them, only lifts the bar", async () => {
    await DELETE(req({ subject: { kind: "guest", guestKey: "g1" } }, "DELETE"), params);
    expect(writes.patch).toBeUndefined();
  });
});
