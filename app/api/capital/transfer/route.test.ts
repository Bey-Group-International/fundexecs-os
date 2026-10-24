import { POST } from "./route";

const authMock = jest.fn();
const initiateMock = jest.fn();
const maybeSingleMock = jest.fn();
const eqCalls: Array<[string, unknown]> = [];

jest.mock("@/lib/auth", () => ({
  requireOrgContext: () => authMock(),
}));

jest.mock("@/lib/providers", () => ({
  getCapitalRailProvider: () => ({ name: "test-rail", initiate: initiateMock }),
}));

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: () => {
      const api: Record<string, unknown> = {
        select: () => api,
        eq: (column: string, value: unknown) => {
          eqCalls.push([column, value]);
          return api;
        },
        maybeSingle: () => maybeSingleMock(),
      };
      return api;
    },
  }),
}));

function request(body: unknown) {
  return new Request("http://localhost/api/capital/transfer", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const admin = {
  ok: true,
  ctx: { orgId: "org_1", userId: "user_1", email: "a@test", role: "admin" },
};

const valid = { capitalEventId: "evt_1", amountUsd: 500, railType: "ach" };

describe("POST /api/capital/transfer", () => {
  beforeEach(() => {
    authMock.mockReset();
    initiateMock.mockReset();
    maybeSingleMock.mockReset();
    eqCalls.length = 0;
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("rejects unauthenticated callers", async () => {
    authMock.mockResolvedValue({ ok: false, status: 401, error: "Not authenticated" });
    const res = await POST(request(valid));
    expect(res.status).toBe(401);
    expect(initiateMock).not.toHaveBeenCalled();
  });

  it.each(["viewer", "member"])("rejects the %s role", async (role) => {
    authMock.mockResolvedValue({ ok: true, ctx: { ...admin.ctx, role } });
    const res = await POST(request(valid));
    expect(res.status).toBe(403);
    expect(initiateMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    authMock.mockResolvedValue(admin);
    const res = await POST(request("{not json"));
    expect(res.status).toBe(400);
    expect(initiateMock).not.toHaveBeenCalled();
  });

  it.each([
    ["missing event", { amountUsd: 5, railType: "ach" }],
    ["zero amount", { ...valid, amountUsd: 0 }],
    ["negative amount", { ...valid, amountUsd: -10 }],
    ["string amount", { ...valid, amountUsd: "500" }],
    ["infinite amount", { ...valid, amountUsd: 1e999 }],
    ["unknown rail", { ...valid, railType: "crypto" }],
  ])("rejects %s", async (_label, body) => {
    authMock.mockResolvedValue(admin);
    const res = await POST(request(body));
    expect(res.status).toBe(400);
    expect(initiateMock).not.toHaveBeenCalled();
  });

  it("404s a capital event that is not the caller's organization's", async () => {
    authMock.mockResolvedValue(admin);
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const res = await POST(request(valid));
    expect(res.status).toBe(404);
    expect(eqCalls).toContainEqual(["organization_id", "org_1"]);
    expect(initiateMock).not.toHaveBeenCalled();
  });

  it("refuses a transfer larger than the capital event", async () => {
    authMock.mockResolvedValue(admin);
    maybeSingleMock.mockResolvedValue({ data: { id: "evt_1", amount: "100.00" }, error: null });
    const res = await POST(request({ ...valid, amountUsd: 100.01 }));
    expect(res.status).toBe(400);
    expect(initiateMock).not.toHaveBeenCalled();
  });

  it("does not leak lookup errors", async () => {
    authMock.mockResolvedValue(admin);
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: "relation boom" } });
    const res = await POST(request(valid));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("boom");
  });

  it("takes the organization and requester from the session, not the body", async () => {
    authMock.mockResolvedValue(admin);
    maybeSingleMock.mockResolvedValue({ data: { id: "evt_1", amount: "500.00" }, error: null });
    initiateMock.mockResolvedValue({ ok: true, live: false, detail: "mock" });

    const res = await POST(
      request({
        ...valid,
        orgId: "org_victim",
        requestedBy: "someone_else",
        toAccountRef: "acct_dest",
        memo: "m",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ provider: "test-rail", ok: true });
    expect(initiateMock).toHaveBeenCalledTimes(1);
    expect(initiateMock.mock.calls[0][0]).toMatchObject({
      orgId: "org_1",
      requestedBy: "user_1",
      capitalEventId: "evt_1",
      amountUsd: 500,
      railType: "ach",
      toAccountRef: "acct_dest",
    });
  });

  it("returns a generic error when the provider throws", async () => {
    authMock.mockResolvedValue(admin);
    maybeSingleMock.mockResolvedValue({ data: { id: "evt_1", amount: "500.00" }, error: null });
    initiateMock.mockRejectedValue(new Error("stripe said: secret detail"));
    const res = await POST(request(valid));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret detail");
  });
});
