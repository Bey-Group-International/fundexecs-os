// lib/integrations/credentials.test.ts
// The dispatch layer's per-org credential resolution — the vault's first
// consumer. Locks in the fast no-op paths (uncredentialed channel, vault not
// configured), the happy path keyed by env-var names, and the degrade-to-env
// behavior when one key fails to decrypt.
const getOrgSecret = jest.fn();
const vaultConfigured = jest.fn();

jest.mock("@/lib/org-secrets", () => ({ getOrgSecret: (...a: unknown[]) => getOrgSecret(...a) }));
jest.mock("@/lib/vault", () => ({ vaultConfigured: () => vaultConfigured() }));

import { resolveChannelCredentials, CHANNEL_SECRET_KEYS, ALL_SECRET_KEYS } from "./credentials";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV, SUPABASE_SERVICE_ROLE_KEY: "service-key" };
  vaultConfigured.mockReturnValue(true);
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("resolveChannelCredentials", () => {
  it("returns an empty bag for a channel with no credentialed keys, without touching the vault", async () => {
    const result = await resolveChannelCredentials("org-1", "meeting");
    expect(result).toEqual({});
    expect(getOrgSecret).not.toHaveBeenCalled();
  });

  it("returns an empty bag when the vault is not configured", async () => {
    vaultConfigured.mockReturnValue(false);
    const result = await resolveChannelCredentials("org-1", "gmail");
    expect(result).toEqual({});
    expect(getOrgSecret).not.toHaveBeenCalled();
  });

  it("returns an empty bag without the service-role key (vault reads need it)", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const result = await resolveChannelCredentials("org-1", "gmail");
    expect(result).toEqual({});
    expect(getOrgSecret).not.toHaveBeenCalled();
  });

  it("resolves every stored key for the channel, keyed by env-var name", async () => {
    getOrgSecret.mockImplementation(async (_orgId: string, key: string) =>
      key === "RESEND_API_KEY" ? "re_org_key" : null,
    );
    const result = await resolveChannelCredentials("org-1", "gmail");
    expect(result).toEqual({ RESEND_API_KEY: "re_org_key" });
    expect(getOrgSecret).toHaveBeenCalledTimes(CHANNEL_SECRET_KEYS.gmail.length);
    expect(getOrgSecret).toHaveBeenCalledWith("org-1", "GMAIL_ACCESS_TOKEN");
  });

  it("degrades a single failing key to the env fallback instead of failing the dispatch", async () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    getOrgSecret.mockImplementation(async (_orgId: string, key: string) => {
      if (key === "GMAIL_ACCESS_TOKEN") throw new Error("auth tag mismatch");
      if (key === "RESEND_API_KEY") return "re_org_key";
      return null;
    });
    const result = await resolveChannelCredentials("org-1", "gmail");
    expect(result).toEqual({ RESEND_API_KEY: "re_org_key" });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("exposes every channel key in the settings allow-list", () => {
    for (const keys of Object.values(CHANNEL_SECRET_KEYS)) {
      for (const key of keys) expect(ALL_SECRET_KEYS).toContain(key);
    }
  });
});
