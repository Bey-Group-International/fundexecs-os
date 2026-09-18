// Host removal. The half of "Remove" that used to not exist.
//
// Before this route, removing somebody was a broadcast and a local close: the
// host's own grid dropped them and nothing else changed anywhere. So the person
// stayed connected to every other participant, and a reload put them back on
// the host's screen too.
//
// The route takes a SIGNALLING ID and resolves it. An earlier version took a
// durable subject that each peer announced over the signalling channel, which
// is a channel anyone with the room code can publish to — so a participant
// could announce somebody else's identity, let the host remove the tile in
// front of them, and have the service role ban the victim instead. What is
// pinned here is that the identity comes from a row the server wrote.

const authMock = jest.fn();
const rlsFrom = jest.fn();

type Tile = { user_id: string | null; guest_key: string | null; display_name: string } | null;

const writes: {
  upsert?: Record<string, unknown>;
  onConflict?: string;
  upsertError: { message: string } | null;
  /** Patches applied to live_meeting_admissions, with what each matched on. */
  admissionPatches: Array<{ patch: Record<string, unknown>; match?: Record<string, unknown> }>;
  match?: Record<string, unknown>;
  denied: Array<{ guest_key: string }>;
  deleted: boolean;
  deleteError: { message: string } | null;
  tables: string[];
  /** What the signalling id resolves to, as the knock recorded it. */
  tile: Tile;
} = {
  upsertError: null,
  admissionPatches: [],
  denied: [],
  deleted: false,
  deleteError: null,
  tables: [],
  tile: { user_id: null, guest_key: "g1", display_name: "Mal" },
};

const broadcasts: Array<{ channel: string; event: string }> = [];

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServerClient: async () => ({ from: (...a: unknown[]) => rlsFrom(...a) }),
  createServiceClient: () => ({
    from: (table: string) => {
      writes.tables.push(table);
      let patch: Record<string, unknown> | null = null;
      let deleting = false;
      const b: Record<string, unknown> = {
        upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => {
          writes.upsert = row;
          writes.onConflict = opts?.onConflict;
          return b;
        },
        update: (p: Record<string, unknown>) => { patch = p; return b; },
        delete: () => { deleting = true; writes.deleted = true; return b; },
        eq: () => b,
        match: (m: Record<string, unknown>) => {
          writes.match = m;
          if (patch) writes.admissionPatches.push({ patch, match: m });
          return b;
        },
        // The tile lookup. `select` stays chainable and awaitable, because the
        // route both reads a row through it and asks the denial for its rows.
        maybeSingle: async () => ({ data: writes.tile, error: null }),
        select: () => b,
        then: (resolve: (v: unknown) => void) =>
          resolve({
            data: writes.denied,
            error: deleting ? writes.deleteError : writes.upsertError,
          }),
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

const tile = (over: Partial<NonNullable<Tile>> = {}) => {
  writes.tile = { user_id: null, guest_key: "g1", display_name: "Mal", ...over };
};

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
  writes.admissionPatches = [];
  writes.match = undefined;
  writes.denied = [];
  writes.deleted = false;
  writes.deleteError = null;
  writes.tables = [];
  writes.tile = { user_id: null, guest_key: "g1", display_name: "Mal" };
  broadcasts.length = 0;
  authMock.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "host-1" } });
  rlsFrom.mockImplementation(() => meetingBuilder(MEETING));
});

describe("POST, who may remove somebody", () => {
  it("refuses a caller with no org context", async () => {
    authMock.mockResolvedValue({ ok: false, error: "Unauthorized", status: 401 });
    expect((await POST(req({ signalId: "sig-1" }), params)).status).toBe(401);
  });

  // Removal is the host's authority, not the organisation's: a teammate in the
  // same org watching the meeting must not be able to eject people from it.
  it("refuses an org member who is not the host", async () => {
    authMock.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "someone-else" } });
    const res = await POST(req({ signalId: "sig-1" }), params);
    expect(res.status).toBe(403);
    expect(writes.upsert).toBeUndefined();
  });

  it("404s for a meeting outside the caller's org", async () => {
    rlsFrom.mockImplementation(() => meetingBuilder(null));
    expect((await POST(req({ signalId: "sig-1" }), params)).status).toBe(404);
  });

  // The door a removed person is refused at is the one the host controls, so a
  // host who removed themselves would be locked out of their own room.
  it("refuses a host removing themselves", async () => {
    tile({ user_id: "host-1", guest_key: null, display_name: "Host" });
    const res = await POST(req({ signalId: "sig-1" }), params);
    expect(res.status).toBe(400);
    expect(writes.upsert).toBeUndefined();
  });

  it("400s without a tile to remove", async () => {
    for (const body of [{}, { signalId: "" }, { signalId: 7 }]) {
      expect((await POST(req(body), params)).status).toBe(400);
    }
    expect(writes.upsert).toBeUndefined();
  });

  // The kick has already gone out, so they are out of the call — but a removal
  // written against a guess is worse than saying it could not be written.
  it("404s when no knock was recorded under that signalling id", async () => {
    writes.tile = null;
    const res = await POST(req({ signalId: "unknown" }), params);
    expect(res.status).toBe(404);
    expect(writes.upsert).toBeUndefined();
  });
});

describe("POST, whose tile it is", () => {
  // The security property this shape exists for: the identity comes from the
  // admission row the knock wrote, never from the request.
  it("takes the identity from the admission, not the request body", async () => {
    tile({ user_id: null, guest_key: "the-real-one", display_name: "Mal" });
    await POST(req({ signalId: "sig-1", subject: { kind: "guest", guestKey: "a-victim" } }), params);
    expect(writes.upsert).toMatchObject({ guest_key: "the-real-one", user_id: null });
  });

  it("takes the name from the admission too", async () => {
    tile({ display_name: "Mallory" });
    await POST(req({ signalId: "sig-1", displayName: "Someone Else" }), params);
    expect(writes.upsert).toMatchObject({ display_name: "Mallory" });
  });
});

describe("POST, what a removal writes", () => {
  it("records a guest against their key", async () => {
    const res = await POST(req({ signalId: "sig-1" }), params);
    expect(res.status).toBe(200);
    expect(writes.upsert).toMatchObject({
      meeting_id: "m1", organization_id: "org1",
      guest_key: "g1", user_id: null,
      display_name: "Mal", removed_by: "host-1",
    });
    expect(writes.onConflict).toBe("meeting_id,guest_key");
  });

  // A member is keyed on their account, because membership is what waves them
  // past the waiting room — a removal on their guest key would not touch them.
  it("records a member against their account", async () => {
    tile({ user_id: "u2", guest_key: null, display_name: "Sam" });
    await POST(req({ signalId: "sig-1" }), params);
    expect(writes.upsert).toMatchObject({ user_id: "u2", guest_key: null });
    expect(writes.onConflict).toBe("meeting_id,user_id");
  });

  it("keeps a name even when the admission had none", async () => {
    tile({ display_name: "" });
    await POST(req({ signalId: "sig-1" }), params);
    expect(writes.upsert).toMatchObject({ display_name: "Guest" });
  });

  // The row IS the operation here, unlike the nudges below. A host told the
  // removal worked when nothing was written would believe somebody was out of
  // the room who is still in it.
  it("fails loudly when the row cannot be written", async () => {
    writes.upsertError = { message: "constraint" };
    expect((await POST(req({ signalId: "sig-1" }), params)).status).toBe(500);
  });
});

describe("POST, shutting the door and telling the room", () => {
  // The exact path a removed guest's reload took back in: the knock is
  // idempotent, so an admission still reading `admitted` let them straight
  // through.
  it("denies the admission they came in on", async () => {
    await POST(req({ signalId: "sig-1" }), params);
    const denial = writes.admissionPatches.at(-1);
    expect(denial?.patch).toMatchObject({ status: "denied", decided_by: "host-1" });
    expect(denial?.match).toEqual({ guest_key: "g1" });
  });

  it("matches a member's admission on their account", async () => {
    tile({ user_id: "u2", guest_key: null, display_name: "Sam" });
    await POST(req({ signalId: "sig-1" }), params);
    expect(writes.admissionPatches.at(-1)?.match).toEqual({ user_id: "u2" });
  });

  // The defect this route exists for: a removal reached the host's own screen
  // and nobody else's, so the person kept streaming to every other participant.
  it("nudges the room so every participant drops them", async () => {
    await POST(req({ signalId: "sig-1" }), params);
    expect(broadcasts.map((b) => b.channel)).toContain(removalChannelName("abc-defg-hi"));
  });

  it("nudges the guest whose admission it just denied", async () => {
    writes.denied = [{ guest_key: "g1" }];
    await POST(req({ signalId: "sig-1" }), params);
    expect(broadcasts.map((b) => b.channel)).toContain("admission:abc-defg-hi:g1");
  });

  // Best-effort, exactly like the admissions route's: the removal is a fact
  // once the row is written, and every client re-reads on its own cadence.
  it("still succeeds when nothing can be published", async () => {
    const res = await POST(req({ signalId: "sig-1" }), params);
    expect(await res.json()).toEqual({ ok: true, removed: 1 });
  });
});

// A removal that could not be undone would be a worse trap than the one it
// replaced: before this change a misclick corrected itself the moment the
// person pressed reload.
describe("DELETE, letting somebody back in", () => {
  it("deletes the removal", async () => {
    const res = await DELETE(req({ signalId: "sig-1" }, "DELETE"), params);
    expect(res.status).toBe(200);
    expect(writes.deleted).toBe(true);
    expect(writes.tables).toContain("live_meeting_removals");
  });

  // Lifting the bar is not enough on its own, and the first version stopped
  // there — which made "Allow back" do nothing at all. POST denies the
  // admission as well, and the knock returns an existing decision rather than
  // reconsidering it, so the person stayed out forever.
  it("puts the denied admission back to waiting", async () => {
    const reset = await DELETE(req({ signalId: "sig-1" }, "DELETE"), params);
    expect(reset.status).toBe(200);
    const patch = writes.admissionPatches.at(-1);
    expect(patch?.patch).toMatchObject({ status: "waiting", decided_at: null, decided_by: null });
    expect(patch?.match).toEqual({ guest_key: "g1" });
  });

  // Waiting, not admitted: this is the host lifting a ban, not readmitting
  // somebody to a meeting they may be nowhere near.
  it("does not readmit them", async () => {
    await DELETE(req({ signalId: "sig-1" }, "DELETE"), params);
    expect(writes.admissionPatches.some((p) => p.patch.status === "admitted")).toBe(false);
  });

  it("lifts a member's removal by their account", async () => {
    tile({ user_id: "u2", guest_key: null, display_name: "Sam" });
    await DELETE(req({ signalId: "sig-1" }, "DELETE"), params);
    expect(writes.admissionPatches.at(-1)?.match).toEqual({ user_id: "u2" });
  });

  // Undo is the same authority as the removal, so it answers to the same check.
  it("refuses anyone but the host", async () => {
    authMock.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "someone-else" } });
    const res = await DELETE(req({ signalId: "sig-1" }, "DELETE"), params);
    expect(res.status).toBe(403);
    expect(writes.deleted).toBe(false);
  });

  // The bar is lifted but the door is still shut, which reads to the host as
  // "Allow back did nothing".
  it("reports a lifted removal whose admission could not be reopened", async () => {
    writes.upsertError = { message: "nope" };
    const res = await DELETE(req({ signalId: "sig-1" }, "DELETE"), params);
    expect(res.status).toBe(500);
  });
});
