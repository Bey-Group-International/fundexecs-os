const authMock = jest.fn();
const clearUpcomingMeetingsLocalMock = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireOrgContext: () => authMock(),
}));

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({}),
}));

jest.mock("@/lib/meetings/service", () => ({
  clearUpcomingMeetingsLocal: (...args: unknown[]) => clearUpcomingMeetingsLocalMock(...args),
}));

import { POST } from "./route";

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({
    ok: true,
    ctx: { orgId: "org1", userId: "u1", role: "owner", email: "u@test" },
  });
});

describe("POST /api/meetings/clear-all", () => {
  it("clears upcoming meetings locally via the service", async () => {
    clearUpcomingMeetingsLocalMock.mockResolvedValue({ ok: true, count: 3 });
    const res = await POST();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, count: 3 });
    expect(clearUpcomingMeetingsLocalMock).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: "org1", userId: "u1" },
    );
  });
});
