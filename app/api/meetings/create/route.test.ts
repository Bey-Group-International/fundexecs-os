// Coverage for the org-membership guard added alongside the
// live_meetings_insert RLS fix (20260703190000_live_meetings_org_scope_insert):
// this route previously wrote organization_id straight from the request body
// with no check that the caller belongs to it, so any authenticated user
// could attribute a meeting to an org they aren't a member of.

const getUser = jest.fn();
const from = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({ auth: { getUser }, from: (...a: unknown[]) => from(...a) }),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/meetings/create", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// A tiny chainable query-builder stub covering the two shapes this route
// needs: the membership check (select/eq/eq/maybeSingle) and the upsert
// (upsert/select/single).
function makeFromStub(opts: { membership?: unknown; upsertResult?: unknown; upsertError?: unknown }) {
  return (_table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: opts.membership ?? null, error: null }),
      upsert: () => builder,
      single: async () => ({ data: opts.upsertResult ?? null, error: opts.upsertError ?? null }),
    };
    return builder;
  };
}

beforeEach(() => jest.clearAllMocks());

describe("POST /api/meetings/create", () => {
  it("rejects an unauthenticated request", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(request({ title: "Sync" }));
    expect(res.status).toBe(401);
  });

  it("rejects an orgId the caller does not belong to, before writing anything", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    from.mockImplementation(makeFromStub({ membership: null }));

    const res = await POST(request({ title: "Sync", orgId: "victim-org" }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not a member/i);
    // Only the membership-check call happened — no upsert call was made.
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("organization_members");
  });

  it("allows creating an org-less meeting with no membership check", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    from.mockImplementation(
      makeFromStub({ upsertResult: { id: "m1", room_code: "abc-defg-hi", host_id: "user-1" } }),
    );

    const res = await POST(request({ title: "Sync" }));

    expect(res.status).toBe(200);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("live_meetings");
  });

  it("allows creating a meeting for an org the caller actually belongs to", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    from.mockImplementation(
      makeFromStub({
        membership: { organization_id: "org-1" },
        upsertResult: { id: "m1", room_code: "abc-defg-hi", host_id: "user-1" },
      }),
    );

    const res = await POST(request({ title: "Sync", orgId: "org-1" }));

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ id: "m1", roomCode: "abc-defg-hi", hostId: "user-1" });
    expect(from).toHaveBeenCalledWith("organization_members");
    expect(from).toHaveBeenCalledWith("live_meetings");
  });
});
