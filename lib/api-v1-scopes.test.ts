// Coverage for API-key scope enforcement (audit P2 — plug-in architecture:
// "an issued key is an all-or-nothing org-wide read credential"). The
// contract: a route naming a required scope 403s keys that lack it (with the
// missing scope in the error, so integrators can self-diagnose), passes keys
// that have it, and legacy full-set keys keep exactly their old access.

const requireApiKey = jest.fn();
jest.mock("@/lib/api-keys-verify", () => ({
  requireApiKey: (...a: unknown[]) => requireApiKey(...a),
}));
jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({}),
}));

import { NextResponse } from "next/server";
import { withApiKey } from "./api-v1";
import { API_SCOPES, DEFAULT_API_SCOPES, isApiScope } from "./api-keys";

function keyWith(scopes: string[]) {
  return { ok: true, key: { orgId: "org-1", mode: "live", keyId: "key-1", scopes } };
}

const request = new Request("http://localhost/api/v1/deals");

describe("withApiKey scope enforcement", () => {
  it("403s a key missing the route's scope, naming the scope", async () => {
    requireApiKey.mockResolvedValue(keyWith(["read:funds"]));
    const handler = jest.fn();
    const route = withApiKey(handler, "read:deals");
    const res = await route(request);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("read:deals");
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs the handler when the scope is granted and passes scopes through", async () => {
    requireApiKey.mockResolvedValue(keyWith(["read:deals"]));
    const handler = jest.fn(async (ctx: { scopes: string[] }) =>
      NextResponse.json({ scopes: ctx.scopes }),
    );
    const route = withApiKey(handler, "read:deals");
    const res = await route(request);
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalled();
    expect((await res.json()).scopes).toEqual(["read:deals"]);
  });

  it("legacy full-set keys pass every scoped route", async () => {
    requireApiKey.mockResolvedValue(keyWith([...API_SCOPES]));
    for (const scope of API_SCOPES) {
      const handler = jest.fn(async () => NextResponse.json({ ok: true }));
      const res = await withApiKey(handler, scope)(request);
      expect(res.status).toBe(200);
    }
  });

  it("unscoped wrapping (whoami) admits any valid key", async () => {
    requireApiKey.mockResolvedValue(keyWith([]));
    const handler = jest.fn(async () => NextResponse.json({ ok: true }));
    const res = await withApiKey(handler)(request);
    expect(res.status).toBe(200);
  });

  it("auth failures still short-circuit before any scope check", async () => {
    requireApiKey.mockResolvedValue({ ok: false, status: 401, error: "Invalid or missing API key" });
    const handler = jest.fn();
    const res = await withApiKey(handler, "read:deals")(request);
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("scope catalog", () => {
  it("validates scope strings", () => {
    expect(isApiScope("read:deals")).toBe(true);
    expect(isApiScope("write:deals")).toBe(true);
    expect(isApiScope("write:funds")).toBe(false);
    expect(isApiScope("")).toBe(false);
  });

  it("default-issued keys get the read set only — write scopes are opt-in", () => {
    expect(DEFAULT_API_SCOPES).toEqual([
      "read:organization",
      "read:deals",
      "read:investors",
      "read:funds",
    ]);
    expect(DEFAULT_API_SCOPES.some((s) => s.startsWith("write:"))).toBe(false);
  });
});
