// Coverage for the org-membership guard added alongside the
// live_meetings_insert RLS fix (20260703190000_live_meetings_org_scope_insert):
// this route previously wrote organization_id straight from the request body
// with no check that the caller belongs to it, so any authenticated user
// could attribute a meeting to an org they aren't a member of.

const authMock = jest.fn();
const from = jest.fn();
jest.mock("@/lib/auth", () => ({
  requireOrgContext: () => authMock(),
}));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({ from: (...a: unknown[]) => from(...a) }),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/meetings/create", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// A tiny chainable query-builder stub covering the live_meetings upsert.
function makeFromStub(opts: { upsertResult?: unknown; upsertError?: unknown }) {
  return (_table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      upsert: () => builder,
      single: async () => ({ data: opts.upsertResult ?? null, error: opts.upsertError ?? null }),
    };
    return builder;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({
    ok: true,
    ctx: { orgId: "org-1", userId: "user-1", email: "u@test", role: "owner" },
  });
});

describe("POST /api/meetings/create", () => {
  it("rejects an unauthenticated request", async () => {
    authMock.mockResolvedValue({ ok: false, status: 401, error: "Not authenticated" });
    const res = await POST(request({ title: "Sync" }));
    expect(res.status).toBe(401);
  });

  it("rejects an orgId different from the active org before writing anything", async () => {
    const res = await POST(request({ title: "Sync", orgId: "victim-org" }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not a member/i);
    expect(from).not.toHaveBeenCalled();
  });

  it("creates a meeting for the active org by default", async () => {
    from.mockImplementation(
      makeFromStub({ upsertResult: { id: "m1", room_code: "abc-defg-hi", host_id: "user-1", scheduled_at: null, duration_minutes: 60 } }),
    );

    const res = await POST(request({ title: "Sync" }));

    expect(res.status).toBe(200);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("live_meetings");
  });

  it("accepts scheduled meeting fields", async () => {
    const upsert = jest.fn(() => builder);
    const builder: Record<string, unknown> = {
      upsert,
      select: () => builder,
      single: async () => ({ data: { id: "m1", room_code: "abc-defg-hi", host_id: "user-1", scheduled_at: "2026-07-05T10:00:00.000Z", duration_minutes: 45 }, error: null }),
    };
    from.mockReturnValue(builder);

    const res = await POST(request({
      title: "Investor Call",
      scheduledAt: "2026-07-05T10:00:00.000Z",
      durationMinutes: 45,
      timezone: "America/New_York",
      meetingType: "investor_meeting",
    }));

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ id: "m1", roomCode: "abc-defg-hi", scheduledAt: "2026-07-05T10:00:00.000Z", durationMinutes: 45 });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: "org-1",
        scheduled_at: "2026-07-05T10:00:00.000Z",
        duration_minutes: 45,
        timezone: "America/New_York",
        meeting_type: "investor_meeting",
      }),
      expect.any(Object),
    );
  });

  it("allows creating a meeting for the active org when orgId matches", async () => {
    from.mockImplementation(
      makeFromStub({
        upsertResult: { id: "m1", room_code: "abc-defg-hi", host_id: "user-1", scheduled_at: null, duration_minutes: 60 },
      }),
    );

    const res = await POST(request({ title: "Sync", orgId: "org-1" }));

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ id: "m1", roomCode: "abc-defg-hi", hostId: "user-1" });
    expect(from).toHaveBeenCalledWith("live_meetings");
  });
});
