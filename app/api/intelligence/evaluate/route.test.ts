import { GET } from "./route";

const authMock = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireOrgContext: () => authMock(),
}));

describe("GET /api/intelligence/evaluate", () => {
  beforeEach(() => authMock.mockReset());

  it("denies non-admin roles", async () => {
    authMock.mockResolvedValue({
      ok: true,
      ctx: { orgId: "org_1", userId: "u1", email: "a@test", role: "member" },
    });

    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Owner or admin role required" });
  });

  it("returns the routing evaluation summary for admins", async () => {
    authMock.mockResolvedValue({
      ok: true,
      ctx: { orgId: "org_1", userId: "u1", email: "a@test", role: "owner" },
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.routing.score).toBe(1);
    expect(json.routing.failed).toBe(0);
    expect(json.research_output_standard.required_columns).toContain("Point of Contact");
    expect(json.research_output_standard.sample_browser_decision).toBe(true);
    expect(json.generated_at).toEqual(expect.any(String));
  });
});
