// The issuance, identity and capital routes act for the signed-in organization:
// they need one, and take it (and who is asking) from the session, never from
// the request.
import { GET as capitalStatus } from "./capital/status/route";
import { GET as identityStatus } from "./identity/status/route";
import { GET as issuanceStatus } from "./issuance/status/route";
import { POST as issuanceIssue } from "./issuance/issue/route";
import { POST as issuanceDraft } from "./issuance/draft/route";
import { POST as identityVerify } from "./identity/verify/route";

const authMock = jest.fn();
const getStatus = jest.fn(async () => ({ ok: true, live: false, detail: "ok" }));
const issueSecurity = jest.fn(async () => ({ ok: true, live: false, detail: "ok" }));
const draftSecurity = jest.fn(async () => ({ ok: true, live: false, detail: "ok" }));
const initiate = jest.fn(async () => ({ ok: true, live: false, detail: "ok" }));

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/providers", () => ({
  getCapitalRailProvider: () => ({ name: "t", getStatus }),
  getIdentityVerificationProvider: () => ({ name: "t", getStatus, initiate }),
  getIssuanceProvider: () => ({ name: "t", getStatus, issueSecurity, draftSecurity }),
}));

const member = { ok: true, ctx: { orgId: "org_1", userId: "user_1", email: "a@test", role: "member" } };

const get = (path: string) => new Request(`http://localhost${path}`);
const post = (path: string, body: unknown) => new Request(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  authMock.mockReset();
  for (const m of [getStatus, issueSecurity, draftSecurity, initiate]) m.mockClear();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("signed out, or signed in without an organization", () => {
  const calls: Array<[string, () => Promise<Response>]> = [
    ["capital status", () => capitalStatus(get("/api/capital/status?transferId=t1"))],
    ["identity status", () => identityStatus(get("/api/identity/status?verificationId=v1"))],
    ["issuance status", () => issuanceStatus(get("/api/issuance/status?securityId=s1"))],
    ["issuance issue", () => issuanceIssue(post("/api/issuance/issue", { securityId: "s1" }))],
    ["issuance draft", () => issuanceDraft(post("/api/issuance/draft", { dealId: "d", securityName: "n", offeringAmountUsd: 1 }))],
    [
      "identity verify",
      () => identityVerify(post("/api/identity/verify", { subjectId: "s", subjectName: "n", subjectType: "individual", level: "kyc" })),
    ],
  ];

  it.each(calls)("%s is refused before any provider is called", async (_name, call) => {
    authMock.mockResolvedValue({ ok: false, status: 403, error: "No active organization" });
    expect((await call()).status).toBe(403);
    for (const m of [getStatus, issueSecurity, draftSecurity, initiate]) expect(m).not.toHaveBeenCalled();
  });
});

describe("status lookups are scoped to the session's organization", () => {
  beforeEach(() => authMock.mockResolvedValue(member));

  it("capital", async () => {
    await capitalStatus(get("/api/capital/status?transferId=t1&orgId=org_other"));
    expect(getStatus).toHaveBeenCalledWith("t1", "org_1");
  });

  it("identity", async () => {
    await identityStatus(get("/api/identity/status?verificationId=v1&orgId=org_other"));
    expect(getStatus).toHaveBeenCalledWith("v1", "org_1");
  });

  it("issuance", async () => {
    await issuanceStatus(get("/api/issuance/status?securityId=s1&orgId=org_other"));
    expect(getStatus).toHaveBeenCalledWith("s1", "org_1");
  });
});

describe("writes ignore an organization or actor named in the body", () => {
  beforeEach(() => authMock.mockResolvedValue(member));

  it("issue", async () => {
    await issuanceIssue(post("/api/issuance/issue", { securityId: "s1", requestedBy: "someone-else", orgId: "org_other" }));
    expect(issueSecurity).toHaveBeenCalledWith("s1", "user_1", "org_1");
  });

  it("draft", async () => {
    await issuanceDraft(
      post("/api/issuance/draft", {
        dealId: "d1",
        securityName: "Units",
        offeringAmountUsd: 10,
        orgId: "org_other",
        requestedBy: "someone-else",
      }),
    );
    expect(draftSecurity).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org_1", requestedBy: "user_1" }));
  });

  it("verify", async () => {
    await identityVerify(
      post("/api/identity/verify", {
        subjectId: "s1",
        subjectName: "N",
        subjectType: "individual",
        level: "kyc",
        orgId: "org_other",
        requestedBy: "someone-else",
      }),
    );
    expect(initiate).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org_1", requestedBy: "user_1" }));
  });
});
