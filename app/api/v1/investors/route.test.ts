// Coverage for /api/v1/investors' pagination: its sort column (name) is
// ascending free text, the opposite direction from deals'/funds' descending
// sort — and needs PostgREST-safe quoting since investor names are
// unconstrained free text that can contain structural filter characters.

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
  requireApiKey.mockResolvedValue({ ok: true, key: { orgId: "org-1", mode: "live", keyId: "key-1", scopes: ["read:organization", "read:deals", "read:investors", "read:funds"] } });
});

describe("GET /api/v1/investors pagination", () => {
  it("orders ascending by name with an ascending id tiebreaker", async () => {
    resolved = { data: [], error: null };
    await GET(request("http://localhost/api/v1/investors"));

    expect(calls).toContainEqual({ method: "order", args: ["name", { ascending: true }] });
    expect(calls).toContainEqual({ method: "order", args: ["id", { ascending: true }] });
  });

  it("builds a > (not <) keyset window, matching ascending order", async () => {
    resolved = { data: [], error: null };
    const cursor = encodeCursor({ v: 'Smith, Jones & Co. (Fund II) "Alpha"', id: "inv-prev" });
    await GET(request(`http://localhost/api/v1/investors?cursor=${cursor}`));

    const orCall = calls.find((c) => c.method === "or");
    // The quoted literal safely embeds the comma/parens/quotes from the name.
    expect(orCall?.args[0]).toContain('name.gt."Smith, Jones & Co. (Fund II) \\"Alpha\\""');
    expect(orCall?.args[0]).toContain('id.gt."inv-prev"');
  });

  it("rejects a malformed cursor with 400", async () => {
    const res = await GET(request("http://localhost/api/v1/investors?cursor=not-valid"));
    expect(res.status).toBe(400);
  });
});
