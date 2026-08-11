// getSessionContext must degrade to "no session" when the auth backend is
// unreachable (paused Supabase project, DNS/network outage). A throw here
// 500s every page that checks auth, including /login.
import { getSessionContext } from "@/lib/auth";
import { createServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServerEnv: jest.fn(),
  createServerClient: jest.fn(),
}));

const mockHasEnv = hasSupabaseServerEnv as jest.Mock;
const mockCreateClient = createServerClient as jest.Mock;

function membershipQuery(result: {
  data: { organization_id: string; role: string } | null;
}) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
}

describe("getSessionContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasEnv.mockReturnValue(true);
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    (console.warn as jest.Mock).mockRestore();
  });

  it("returns null without touching the client when env is missing", async () => {
    mockHasEnv.mockReturnValue(false);
    await expect(getSessionContext()).resolves.toBeNull();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("returns null when there is no signed-in user", async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
    });
    await expect(getSessionContext()).resolves.toBeNull();
  });

  it("returns the session context for a signed-in user with a membership", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: "u1", email: "u1@example.com" } },
        }),
      },
      from: jest.fn().mockReturnValue(
        membershipQuery({ data: { organization_id: "org1", role: "owner" } }),
      ),
    });
    await expect(getSessionContext()).resolves.toEqual({
      userId: "u1",
      email: "u1@example.com",
      orgId: "org1",
      role: "owner",
    });
  });

  it("returns null instead of throwing when auth.getUser rejects (backend unreachable)", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: jest
          .fn()
          .mockRejectedValue(new TypeError("fetch failed")),
      },
    });
    await expect(getSessionContext()).resolves.toBeNull();
  });

  it("returns null instead of throwing when the membership query rejects", async () => {
    const query = membershipQuery({ data: null });
    query.maybeSingle.mockRejectedValue(new TypeError("fetch failed"));
    mockCreateClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: "u1", email: "u1@example.com" } },
        }),
      },
      from: jest.fn().mockReturnValue(query),
    });
    await expect(getSessionContext()).resolves.toBeNull();
  });
});
