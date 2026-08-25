// lib/email-config.test.ts
// The email self-check: can THIS org send right now, and if not, what should an
// operator do about it? Reports state only — never a secret value.
const getOrgSecretMock = jest.fn();
const getGoogleAccessTokenMock = jest.fn();

jest.mock("@/lib/org-secrets", () => ({
  getOrgSecretBounded: (...args: unknown[]) => getOrgSecretMock(...args),
}));

jest.mock("@/lib/google-oauth", () => ({
  getGoogleAccessToken: (...args: unknown[]) => getGoogleAccessTokenMock(...args),
  googleOAuthConfigured: () => Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID),
}));

import { getEmailConfigStatus } from "./email";

const OLD = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...OLD };
  delete process.env.GMAIL_ACCESS_TOKEN;
  delete process.env.FUNDEXECS_FROM_EMAIL;
  process.env.GOOGLE_OAUTH_CLIENT_ID = "client";
  getOrgSecretMock.mockResolvedValue(null);
  getGoogleAccessTokenMock.mockResolvedValue(null);
});

afterAll(() => {
  process.env = OLD;
});

describe("getEmailConfigStatus", () => {
  it("tells an org with no mailbox how to connect one", async () => {
    const s = await getEmailConfigStatus("org1");
    expect(s.mailboxConnected).toBe(false);
    expect(s.willAttemptSend).toBe(false);
    expect(s.source).toBe("none");
    expect(s.notes.join(" ")).toMatch(/Connect Google in Settings/);
  });

  it("names the deployment gap when OAuth itself is unconfigured", async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    const s = await getEmailConfigStatus("org1");
    expect(s.oauthConfigured).toBe(false);
    expect(s.notes.join(" ")).toMatch(/GOOGLE_OAUTH_CLIENT_ID/);
  });

  it("reports a connected org as sending from its own mailbox", async () => {
    getGoogleAccessTokenMock.mockResolvedValue("minted");
    const s = await getEmailConfigStatus("org1");
    expect(s).toMatchObject({ mailboxConnected: true, source: "org-oauth", willAttemptSend: true });
    expect(s.notes.join(" ")).toMatch(/connected Google mailbox/);
  });

  it("flags a stored static token as short-lived", async () => {
    getOrgSecretMock.mockImplementation(async (_org: string, key: string) =>
      key === "GMAIL_ACCESS_TOKEN" ? "pasted" : null,
    );
    const s = await getEmailConfigStatus("org1");
    expect(s.source).toBe("org-token");
    expect(s.notes.join(" ")).toMatch(/about an hour/);
  });

  it("reports the credential a real send would pick, not the stale paste", async () => {
    // Precedence here must mirror the sender: OAuth first.
    getGoogleAccessTokenMock.mockResolvedValue("minted");
    getOrgSecretMock.mockResolvedValue("stale-paste");
    const s = await getEmailConfigStatus("org1");
    expect(s.source).toBe("org-oauth");
  });

  it("flags the deploy-wide token as shared and short-lived", async () => {
    process.env.GMAIL_ACCESS_TOKEN = "env";
    const s = await getEmailConfigStatus("org1");
    expect(s.source).toBe("deploy-env");
    expect(s.notes.join(" ")).toMatch(/shared by every org/);
  });

  it("warns that an explicit From only works as a verified alias", async () => {
    getGoogleAccessTokenMock.mockResolvedValue("minted");
    process.env.FUNDEXECS_FROM_EMAIL = "meetings@acme.vc";
    const s = await getEmailConfigStatus("org1");
    expect(s.fromEmail).toBe("meetings@acme.vc");
    expect(s.notes.join(" ")).toMatch(/verified send-as aliases/);
  });

  it("never returns a secret value", async () => {
    getOrgSecretMock.mockImplementation(async (_org: string, key: string) =>
      key === "GMAIL_ACCESS_TOKEN" ? "super-secret-token" : null,
    );
    const s = await getEmailConfigStatus("org1");
    expect(JSON.stringify(s)).not.toContain("super-secret-token");
  });
});
