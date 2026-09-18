// "Are the people I can see still supposed to be here?"
//
// The removal nudge carries no names, because anyone holding the room code can
// publish on a broadcast channel and a nudge that named its target would be a
// way to eject anybody from any meeting whose link was ever forwarded. So each
// client asks here instead, naming the SIGNALLING IDS it can see — identifiers
// everyone in the room already has for everyone else, so naming them discloses
// nothing — and the server resolves each one against the row the knock wrote.
//
// It answers only about ids the caller named, and it answers WITH those ids
// rather than with anybody's durable identity, so it can be used neither to
// enumerate a meeting's guests nor to learn a guest key.

const from = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServerClient: async () => ({ from: (...a: unknown[]) => from(...a) }),
  createServiceClient: () => ({ from: (...a: unknown[]) => from(...a) }),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";
import { clearRateLimitBucketsForTests } from "@/lib/rate-limit";


const params = { params: Promise.resolve({ roomCode: "abc-defg-hi" }) };

function req(body: unknown, ip = "203.0.113.9") {
  return new NextRequest("http://localhost/api/meetings/public/abc-defg-hi/removed", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "x-vercel-forwarded-for": ip },
  });
}

/**
 * The meeting with its removals embedded, and the admissions the signalling
 * ids resolve to — which is how the route reads both.
 */
function wire(meeting: unknown, admissions: Array<{ signal_id: string }> = []) {
  from.mockImplementation(() => {
    // `in` is honoured, because the route's guarantee — it never reports a tile
    // the caller did not name — is a property of that filter. A harness that
    // ignored it would let a test claim the guarantee while proving nothing.
    let asked: string[] | null = null;
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, is: () => b,
      in: (_col: string, values: string[]) => { asked = values; return b; },
      maybeSingle: async () => ({ data: meeting, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(resolve({
          data: asked ? admissions.filter((a) => asked!.includes(a.signal_id)) : admissions,
          error: null,
        })),
    };
    return b;
  });
}

/** An admission row: a tile, and who the knock recorded behind it. */
const tile = (signalId: string, over: { user_id?: string | null; guest_key?: string | null } = {}) => ({
  signal_id: signalId, user_id: null, guest_key: null, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  clearRateLimitBucketsForTests();
});

describe("who has been removed", () => {
  it("names the tile of a removed guest", async () => {
    wire(
      { id: "m1", live_meeting_removals: [{ user_id: null, guest_key: "g9" }] },
      [tile("sig-a", { guest_key: "g1" }), tile("sig-b", { guest_key: "g9" })],
    );
    const res = await POST(req({ signalIds: ["sig-a", "sig-b"] }), params);
    expect(await res.json()).toEqual({ removed: ["sig-b"] });
  });

  it("names the tile of a removed member", async () => {
    wire(
      { id: "m1", live_meeting_removals: [{ user_id: "u2", guest_key: null }] },
      [tile("sig-a", { user_id: "u2" }), tile("sig-b", { user_id: "u3" })],
    );
    const res = await POST(req({ signalIds: ["sig-a", "sig-b"] }), params);
    expect(await res.json()).toEqual({ removed: ["sig-a"] });
  });

  // Both identifiers, independently, for the same reason the knock checks
  // both: a guest removed by key who has since signed in would otherwise be
  // looked up under an account nobody removed.
  it("catches a removed guest key even on a signed-in caller", async () => {
    wire(
      { id: "m1", live_meeting_removals: [{ user_id: null, guest_key: "g9" }] },
      [tile("sig-a", { user_id: "u5", guest_key: "g9" })],
    );
    const res = await POST(req({ signalIds: ["sig-a"] }), params);
    expect(await res.json()).toEqual({ removed: ["sig-a"] });
  });

  it("says nothing when nobody has been removed", async () => {
    wire({ id: "m1", live_meeting_removals: [] }, [tile("sig-a", { guest_key: "g1" })]);
    const res = await POST(req({ signalIds: ["sig-a"] }), params);
    expect(await res.json()).toEqual({ removed: [] });
  });

  // The safeguard this endpoint's shape exists for. It answers WITH signalling
  // ids — which everyone in the room already has — and never with a guest key,
  // which would be enough to read that guest's status from the poll next door.
  it("never returns anybody's durable identity", async () => {
    wire(
      { id: "m1", live_meeting_removals: [{ user_id: null, guest_key: "secret-key" }] },
      [tile("sig-a", { guest_key: "secret-key" })],
    );
    const res = await POST(req({ signalIds: ["sig-a"] }), params);
    expect(JSON.stringify(await res.json())).not.toContain("secret-key");
  });

  // Somebody else in the meeting has been removed. A caller who did not name
  // their tile must not be told about it — that is the difference between
  // "check my peers" and "list this meeting's removals".
  it("never names a tile the caller did not ask about", async () => {
    wire(
      { id: "m1", live_meeting_removals: [{ user_id: null, guest_key: "g9" }] },
      [tile("sig-somebody-else", { guest_key: "g9" })],
    );
    const res = await POST(req({ signalIds: ["sig-mine"] }), params);
    expect(await res.json()).toEqual({ removed: [] });
  });

  it("returns nothing for an empty ask, without querying", async () => {
    wire({ id: "m1", live_meeting_removals: [] });
    const res = await POST(req({ signalIds: [] }), params);
    expect(await res.json()).toEqual({ removed: [] });
    expect(from).not.toHaveBeenCalled();
  });

  // Nobody removed means nothing to resolve anyone against, so the second
  // query is not worth making on a call where nothing has happened — which is
  // every call.
  it("does not look up tiles when the meeting has no removals", async () => {
    wire({ id: "m1", live_meeting_removals: [] }, [tile("sig-a", { guest_key: "g1" })]);
    await POST(req({ signalIds: ["sig-a"] }), params);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("ignores the entries it cannot read and answers about the rest", async () => {
    wire(
      { id: "m1", live_meeting_removals: [{ user_id: null, guest_key: "g9" }] },
      [tile("sig-b", { guest_key: "g9" })],
    );
    const res = await POST(req({ signalIds: [null, 7, "", "sig-b"] }), params);
    expect(await res.json()).toEqual({ removed: ["sig-b"] });
  });

  it("survives a body that is not what it expected", async () => {
    wire({ id: "m1", live_meeting_removals: [] });
    for (const body of [{}, { signalIds: "sig-a" }, { signalIds: 4 }]) {
      expect(await (await POST(req(body), params)).json()).toEqual({ removed: [] });
    }
  });
});

describe("a room code that resolves to nothing", () => {
  // Unauthenticated callers have no business learning which room codes are
  // real, so this is the same answer as a room nobody was removed from.
  it("answers as if nobody had been removed", async () => {
    wire(null);
    const res = await POST(req({ signalIds: ["sig-a"] }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: [] });
  });
});

describe("bounds", () => {
  // This is not on a per-tick path like the knock poll — a client asks on a
  // nudge and on a join — but it is unauthenticated and reachable by anyone
  // holding a room code, so it is bounded like its neighbours.
  it("refuses a flood from one address", async () => {
    wire({ id: "m1", live_meeting_removals: [] });
    let refused: Response | null = null;
    for (let i = 0; i < 400; i++) {
      const res = await POST(req({ signalIds: [`sig-${i}`] }), params);
      if (res.status === 429) { refused = res; break; }
    }
    expect(refused).not.toBeNull();
    expect(refused!.headers.get("Retry-After")).toBeTruthy();
  });

  it("counts each address separately", async () => {
    wire({ id: "m1", live_meeting_removals: [] });
    for (let i = 0; i < 400; i++) {
      const res = await POST(req({ signalIds: [`sig-${i}`] }, "198.51.100.1"), params);
      if (res.status === 429) break;
    }
    const other = await POST(req({ signalIds: ["sig-a"] }, "198.51.100.2"), params);
    expect(other.status).toBe(200);
  });

  // A meeting is a handful of people. The cap is what stops one request being
  // used as a bulk oracle.
  it("caps a huge ask rather than answering all of it", async () => {
    wire(
      { id: "m1", live_meeting_removals: [{ user_id: null, guest_key: "g1" }] },
      [tile("sig-400", { guest_key: "g1" })],
    );
    const many = Array.from({ length: 500 }, (_, i) => `sig-${i}`);
    const res = await POST(req({ signalIds: many }), params);
    // sig-400 is past the cap, so it is never asked about and never answered.
    expect(await res.json()).toEqual({ removed: [] });
  });
});
