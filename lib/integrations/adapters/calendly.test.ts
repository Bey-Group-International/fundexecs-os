// Coverage for the env-var contract fix: this adapter previously checked
// CALENDLY_API_KEY, a name nothing else in the repo used (.env.example and the
// inbox mock module both used CALENDLY_API_TOKEN) — so following the
// documented setup steps could never activate the real API path. It now reads
// the same name everything else does.
import { calendlyAdapter } from "./calendly";
import type { ActionKind } from "@/lib/gates";
import type { DispatchContext } from "../types";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.CALENDLY_API_TOKEN;
  delete process.env.CALENDLY_ACCESS_TOKEN;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

const ctx = (overrides: Partial<DispatchContext> = {}): DispatchContext => ({
  orgId: "org-1",
  actorId: "user-1",
  action: "propose_meeting" as ActionKind,
  target: { name: "Acme Family Office", email: "lp@acme.test" },
  ...overrides,
});

describe("calendly adapter env-var contract", () => {
  it("is unconfigured with no token set", () => {
    expect(calendlyAdapter.isConfigured()).toBe(false);
  });

  it("recognizes CALENDLY_API_TOKEN — the name .env.example documents", () => {
    process.env.CALENDLY_API_TOKEN = "test-token";
    expect(calendlyAdapter.isConfigured()).toBe(true);
  });

  it("recognizes CALENDLY_ACCESS_TOKEN as an alternate name", () => {
    process.env.CALENDLY_ACCESS_TOKEN = "test-token";
    expect(calendlyAdapter.isConfigured()).toBe(true);
  });

  it("does NOT recognize the old CALENDLY_API_KEY name (contract now matches the rest of the repo)", () => {
    process.env.CALENDLY_API_KEY = "test-key";
    expect(calendlyAdapter.isConfigured()).toBe(false);
  });

  it("stays in mock mode (ok:true, live:false) when unconfigured or not connected", async () => {
    const result = await calendlyAdapter.dispatch(ctx({ connected: false }));
    expect(result.ok).toBe(true);
    expect(result.live).toBe(false);
    expect(result.detail).toContain("not connected");
  });
});

describe("calendly adapter per-org credential preference", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).includes("/users/me")
          ? { resource: { uri: "https://api.calendly.com/users/u-1", scheduling_url: "https://calendly.com/org" } }
          : { collection: [{ scheduling_url: "https://calendly.com/org/intro", name: "Intro" }] },
    }));
  });

  it("uses the org's vault token over the deploy env var", async () => {
    process.env.CALENDLY_API_TOKEN = "env-token";
    const result = await calendlyAdapter.dispatch(
      ctx({ connected: true, secrets: { CALENDLY_API_TOKEN: "org-token" } }),
    );
    expect(result.live).toBe(true);
    const authHeaders = fetchMock.mock.calls.map((c) => c[1]?.headers?.Authorization);
    expect(authHeaders).toEqual(["Bearer org-token", "Bearer org-token"]);
  });

  it("falls back to the env token when the org has no vault credential", async () => {
    process.env.CALENDLY_API_TOKEN = "env-token";
    const result = await calendlyAdapter.dispatch(ctx({ connected: true, secrets: {} }));
    expect(result.live).toBe(true);
    expect(fetchMock.mock.calls[0][1]?.headers?.Authorization).toBe("Bearer env-token");
  });

  it("stays in mock mode when connected but no token resolves anywhere", async () => {
    const result = await calendlyAdapter.dispatch(ctx({ connected: true, secrets: {} }));
    expect(result.ok).toBe(true);
    expect(result.live).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
