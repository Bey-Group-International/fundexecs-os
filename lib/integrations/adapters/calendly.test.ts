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
