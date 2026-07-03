// Coverage for the v1 pagination fix: /api/v1/deals used to return every deal
// for the org in one unbounded response. It now caps the page size and
// supports a keyset cursor (lib/api-v1-cursor.ts) so a large pipeline pages
// instead of coming back all at once.

const requireApiKey = jest.fn();
jest.mock("@/lib/api-keys-verify", () => ({ requireApiKey: (...a: unknown[]) => requireApiKey(...a) }));

const calls: { method: string; args: unknown[] }[] = [];
let resolved: { data: unknown; error: unknown } = { data: [], error: null };

function makeChain() {
  const chain: Record<string, unknown> = {
    select: (...a: unknown[]) => { calls.push({ method: "select", args: a }); return chain; },
    eq: (...a: unknown[]) => { calls.push({ method: "eq", args: a }); return chain; },
    order: (...a: unknown[]) => { calls.push({ method: "order", args: a }); return chain; },
    limit: (...a: unknown[]) => { calls.push({ method: "limit", args: a }); return chain; },
    or: (...a: unknown[]) => { calls.push({ method: "or", args: a }); return chain; },
    then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve(resolved).then(onFulfilled),
  };
  return chain;
}

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ from: () => makeChain() }),
}));

import { GET } from "./route";
import { encodeCursor } from "@/lib/api-v1-cursor";

function request(url: string): Request {
  return new Request(url, { headers: { Authorization: "Bearer fxsk_test" } });
}

beforeEach(() => {
  calls.length = 0;
  requireApiKey.mockResolvedValue({ ok: true, key: { orgId: "org-1", mode: "live", keyId: "key-1" } });
});

const row = (over: Partial<{ id: string; updated_at: string }> = {}) => ({
  id: "d1",
  name: "Acme Deal",
  stage: "diligence",
  asset_class: "real_estate",
  geography: "US",
  target_amount: 1_000_000,
  expected_close: "2026-12-01",
  updated_at: "2026-06-01T00:00:00+00:00",
  ...over,
});

describe("GET /api/v1/deals", () => {
  it("returns 401 for an invalid key without querying the database", async () => {
    requireApiKey.mockResolvedValue({ ok: false, status: 401, error: "Invalid or missing API key" });
    const res = await GET(request("http://localhost/api/v1/deals"));
    expect(res.status).toBe(401);
    expect(calls.length).toBe(0);
  });

  it("scopes the query to the key's org and defaults to a 50-row page", async () => {
    resolved = { data: [row()], error: null };
    const res = await GET(request("http://localhost/api/v1/deals"));
    const body = await res.json();

    expect(calls).toContainEqual({ method: "eq", args: ["organization_id", "org-1"] });
    expect(calls.find((c) => c.method === "limit")?.args).toEqual([51]); // limit+1 to detect a next page
    expect(body.nextCursor).toBeNull();
    expect(body.count).toBe(1);
  });

  it("clamps an oversized ?limit= to 200 and returns a nextCursor when more rows exist", async () => {
    // 201 rows returned for a requested limit of 200 -> hasMore true.
    resolved = { data: Array.from({ length: 201 }, (_, i) => row({ id: `d${i}`, updated_at: `2026-06-01T00:00:0${i % 9}+00:00` })), error: null };
    const res = await GET(request("http://localhost/api/v1/deals?limit=99999"));
    const body = await res.json();

    expect(calls.find((c) => c.method === "limit")?.args).toEqual([201]); // clamped 200 + 1
    expect(body.data).toHaveLength(200);
    expect(body.nextCursor).toEqual(expect.any(String));
  });

  it("rejects a malformed cursor with 400", async () => {
    const res = await GET(request("http://localhost/api/v1/deals?cursor=not-valid-base64url-json"));
    expect(res.status).toBe(400);
  });

  it("builds the keyset window from a valid cursor", async () => {
    resolved = { data: [], error: null };
    const cursor = encodeCursor({ v: "2026-05-01T00:00:00+00:00", id: "d-prev" });
    await GET(request(`http://localhost/api/v1/deals?cursor=${cursor}`));

    const orCall = calls.find((c) => c.method === "or");
    expect(orCall?.args[0]).toContain('updated_at.lt."2026-05-01T00:00:00+00:00"');
    expect(orCall?.args[0]).toContain('id.lt."d-prev"');
  });
});
