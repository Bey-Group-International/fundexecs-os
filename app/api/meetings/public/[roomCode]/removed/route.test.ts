// "Are the people I can see still supposed to be here?"
//
// The removal nudge carries no names, because anyone holding the room code can
// publish on a broadcast channel and a nudge that named its target would be a
// way to eject anybody from any meeting whose link was ever forwarded. So each
// client asks here instead, naming the peers it can see — and the shape of this
// endpoint is the whole safeguard: it answers about the subjects it was GIVEN
// and returns nothing else, so it cannot be turned into a way to enumerate a
// meeting's guest keys.

const from = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServerClient: async () => ({ from: (...a: unknown[]) => from(...a) }),
  createServiceClient: () => ({ from: (...a: unknown[]) => from(...a) }),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";
import { clearRateLimitBucketsForTests } from "@/lib/rate-limit";
import { subjectKey } from "@/lib/meetings/removal";

const params = { params: Promise.resolve({ roomCode: "abc-defg-hi" }) };

function req(body: unknown, ip = "203.0.113.9") {
  return new NextRequest("http://localhost/api/meetings/public/abc-defg-hi/removed", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "x-vercel-forwarded-for": ip },
  });
}

/** The meeting with its removals embedded, which is how the route reads them. */
function wire(meeting: unknown) {
  from.mockImplementation(() => {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, is: () => b,
      maybeSingle: async () => ({ data: meeting, error: null }),
    };
    return b;
  });
}

const guest = (guestKey: string) => ({ kind: "guest" as const, guestKey });
const member = (userId: string) => ({ kind: "member" as const, userId });

beforeEach(() => {
  jest.clearAllMocks();
  clearRateLimitBucketsForTests();
});

describe("who has been removed", () => {
  it("names a removed guest among the peers it was asked about", async () => {
    wire({ id: "m1", live_meeting_removals: [{ user_id: null, guest_key: "g9" }] });
    const res = await POST(req({ subjects: [guest("g1"), guest("g9")] }), params);
    expect(await res.json()).toEqual({ removed: [subjectKey(guest("g9"))] });
  });

  it("names a removed member", async () => {
    wire({ id: "m1", live_meeting_removals: [{ user_id: "u2", guest_key: null }] });
    const res = await POST(req({ subjects: [member("u2"), member("u3")] }), params);
    expect(await res.json()).toEqual({ removed: [subjectKey(member("u2"))] });
  });

  it("says nothing when nobody has been removed", async () => {
    wire({ id: "m1", live_meeting_removals: [] });
    const res = await POST(req({ subjects: [guest("g1")] }), params);
    expect(await res.json()).toEqual({ removed: [] });
  });

  // The safeguard this endpoint's shape exists for. A guest key is enough to
  // read that guest's admission status from the poll endpoint next door, so a
  // caller must never learn one it did not already hold.
  it("never returns a subject the caller did not name", async () => {
    wire({ id: "m1", live_meeting_removals: [{ user_id: null, guest_key: "secret-key" }] });
    const res = await POST(req({ subjects: [guest("mine")] }), params);
    expect(await res.json()).toEqual({ removed: [] });
  });

  it("returns nothing for an empty ask, without querying", async () => {
    wire({ id: "m1", live_meeting_removals: [] });
    const res = await POST(req({ subjects: [] }), params);
    expect(await res.json()).toEqual({ removed: [] });
    expect(from).not.toHaveBeenCalled();
  });

  // One peer on an older build announces no identity. That must not stop this
  // client learning about the peers that did.
  it("ignores the entries it cannot read and answers about the rest", async () => {
    wire({ id: "m1", live_meeting_removals: [{ user_id: null, guest_key: "g9" }] });
    const res = await POST(req({ subjects: [null, "g9", { kind: "what" }, guest("g9")] }), params);
    expect(await res.json()).toEqual({ removed: [subjectKey(guest("g9"))] });
  });

  it("survives a body that is not what it expected", async () => {
    wire({ id: "m1", live_meeting_removals: [] });
    for (const body of [{}, { subjects: "g1" }, { subjects: 4 }]) {
      expect(await (await POST(req(body), params)).json()).toEqual({ removed: [] });
    }
  });
});

describe("a room code that resolves to nothing", () => {
  // Unauthenticated callers have no business learning which room codes are
  // real, so this is the same answer as a room nobody was removed from.
  it("answers as if nobody had been removed", async () => {
    wire(null);
    const res = await POST(req({ subjects: [guest("g1")] }), params);
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
      const res = await POST(req({ subjects: [guest(`g${i}`)] }), params);
      if (res.status === 429) { refused = res; break; }
    }
    expect(refused).not.toBeNull();
    expect(refused!.headers.get("Retry-After")).toBeTruthy();
  });

  it("counts each address separately", async () => {
    wire({ id: "m1", live_meeting_removals: [] });
    for (let i = 0; i < 400; i++) {
      const res = await POST(req({ subjects: [guest(`g${i}`)] }, "198.51.100.1"), params);
      if (res.status === 429) break;
    }
    const other = await POST(req({ subjects: [guest("g1")] }, "198.51.100.2"), params);
    expect(other.status).toBe(200);
  });

  // A meeting is a handful of people. The cap is what stops one request being
  // used as a bulk oracle.
  it("only answers about the first batch of a huge ask", async () => {
    wire({ id: "m1", live_meeting_removals: [{ user_id: null, guest_key: "g200" }] });
    const many = Array.from({ length: 500 }, (_, i) => guest(`g${i}`));
    const res = await POST(req({ subjects: many }), params);
    expect(await res.json()).toEqual({ removed: [] });
  });
});
