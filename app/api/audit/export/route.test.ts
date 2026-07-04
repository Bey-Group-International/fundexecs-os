import { GET } from "./route";

const authMock = jest.fn();
const selectMock = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireOrgContext: () => authMock(),
}));

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({
    from: () => ({
      select: selectMock,
    }),
  }),
}));

function chain(data: unknown, error: unknown = null) {
  const api: Record<string, unknown> = {
    eq: jest.fn(() => api),
    order: jest.fn(() => api),
    limit: jest.fn(async () => ({ data, error })),
  };
  return api;
}

describe("GET /api/audit/export", () => {
  beforeEach(() => {
    authMock.mockReset();
    selectMock.mockReset();
  });

  it("denies viewers", async () => {
    authMock.mockResolvedValue({
      ok: true,
      ctx: { orgId: "org_1", userId: "u1", email: "a@test", role: "viewer" },
    });

    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Owner or admin role required" });
  });

  it("exports admin-scoped audit rows as CSV", async () => {
    authMock.mockResolvedValue({
      ok: true,
      ctx: { orgId: "org_1", userId: "u1", email: "a@test", role: "admin" },
    });
    selectMock.mockReturnValue(chain([
      {
        created_at: "2026-07-04T00:00:00Z",
        action: "integration.connected",
        entity_type: "integration",
        entity_id: "gmail",
        principal_id: "u1",
        ip_address: null,
        before_state: null,
        after_state: { status: "connected" },
      },
    ]));

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const body = await res.text();
    expect(body).toContain("created_at,action,entity_type");
    expect(body).toContain('"integration.connected"');
    expect(body).toContain('"{""status"":""connected""}"');
  });
});
