// Coverage for SFU room authorization (audit follow-up to the JWT fix: the
// gateway verified WHO the caller was but let any authenticated user join any
// roomId — and the shipped client put every tenant in one literal
// "office-main" room). The contract under test: plain rooms resolve into the
// caller's own org namespace, explicit org rooms are honored only for
// members, and every failure path resolves to null (the gateway's 403).
import { OrgAuthorizer } from "./src/OrgAuthorizer";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

function membershipResponse(orgIds: string[], ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => orgIds.map((organization_id) => ({ organization_id })),
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(membershipResponse([ORG_A]));
});

describe("OrgAuthorizer.resolveRoom", () => {
  const authorizer = () => new OrgAuthorizer("https://proj.supabase.co", "service-key");

  it("namespaces a plain room into the caller's primary org", async () => {
    const room = await authorizer().resolveRoom("user-1", "office-main");
    expect(room).toBe(`org:${ORG_A}:office-main`);
    // The membership query is scoped to the caller and ordered for stability.
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("principal_id=eq.user-1");
    expect(url).toContain("order=created_at.asc");
  });

  it("honors an explicit org room only for members", async () => {
    const a = authorizer();
    expect(await a.resolveRoom("user-1", `org:${ORG_A}:boardroom`)).toBe(
      `org:${ORG_A}:boardroom`,
    );
    expect(await a.resolveRoom("user-1", `org:${ORG_B}:boardroom`)).toBeNull();
  });

  it("refuses callers with no org memberships", async () => {
    fetchMock.mockResolvedValue(membershipResponse([]));
    expect(await authorizer().resolveRoom("user-1", "office-main")).toBeNull();
  });

  it("refuses malformed room names instead of minting junk rooms", async () => {
    const a = authorizer();
    expect(await a.resolveRoom("user-1", "office main")).toBeNull();
    expect(await a.resolveRoom("user-1", "org:not-a-uuid:x")).toBeNull();
    expect(await a.resolveRoom("user-1", "a".repeat(65))).toBeNull();
  });

  it("fails closed when unconfigured", async () => {
    const a = new OrgAuthorizer("", "");
    expect(await a.resolveRoom("user-1", "office-main")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws (cannot-authorize) on a failed membership lookup", async () => {
    fetchMock.mockResolvedValue(membershipResponse([], false, 500));
    await expect(authorizer().resolveRoom("user-1", "office-main")).rejects.toThrow(/500/);
  });

  it("caches memberships within the TTL and refetches after it lapses", async () => {
    const a = new OrgAuthorizer("https://proj.supabase.co", "service-key", 60_000);
    await a.resolveRoom("user-1", "office-main");
    await a.resolveRoom("user-1", "lounge");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const expired = new OrgAuthorizer("https://proj.supabase.co", "service-key", -1);
    await expired.resolveRoom("user-1", "office-main");
    await expired.resolveRoom("user-1", "office-main");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
