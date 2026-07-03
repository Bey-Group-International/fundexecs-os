// Coverage for the v1 pagination fix on /api/v1/funds specifically: its sort
// column (vintage_year) is nullable with nulls-last ordering, which needs a
// different keyset window depending on whether the cursor itself landed in
// the non-null region or the null tail — this is the trickiest of the three
// v1 list routes' pagination logic.

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
    is: (...a: unknown[]) => { calls.push({ method: "is", args: a }); return chain; },
    lt: (...a: unknown[]) => { calls.push({ method: "lt", args: a }); return chain; },
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

const row = (over: Partial<{ id: string; vintage_year: number | null }> = {}) => ({
  id: "f1",
  name: "Fund I",
  fund_type: "fund",
  vintage_year: 2024,
  target_size: 100_000_000,
  committed_capital: 90_000_000,
  called_capital: 30_000_000,
  distributed_capital: 5_000_000,
  currency: "USD",
  ...over,
});

describe("GET /api/v1/funds pagination", () => {
  it("builds an OR window (including the null tail) from a non-null cursor", async () => {
    resolved = { data: [], error: null };
    const cursor = encodeCursor({ v: "2022", id: "f-prev" });
    await GET(request(`http://localhost/api/v1/funds?cursor=${cursor}`));

    const orCall = calls.find((c) => c.method === "or");
    expect(orCall?.args[0]).toContain('vintage_year.lt."2022"');
    expect(orCall?.args[0]).toContain('id.lt."f-prev"');
    expect(orCall?.args[0]).toContain("vintage_year.is.null");
    expect(calls.some((c) => c.method === "is")).toBe(false);
  });

  it("builds a plain AND window (no null-tail alternation needed) from a null cursor", async () => {
    resolved = { data: [], error: null };
    const cursor = encodeCursor({ v: null, id: "f-prev-null" });
    await GET(request(`http://localhost/api/v1/funds?cursor=${cursor}`));

    // Already in the null tail: next page is more nulls ordered by id, a
    // plain AND — no .or() alternation should be built.
    expect(calls.some((c) => c.method === "or")).toBe(false);
    expect(calls).toContainEqual({ method: "is", args: ["vintage_year", null] });
    expect(calls).toContainEqual({ method: "lt", args: ["id", "f-prev-null"] });
  });

  it("rejects a malformed cursor with 400", async () => {
    const res = await GET(request("http://localhost/api/v1/funds?cursor=garbage"));
    expect(res.status).toBe(400);
  });

  it("encodes a null nextCursor value when the last row of a page has no vintage_year", async () => {
    // 2 rows requested with limit=1 -> hasMore true, last row (kept) has vintage_year: null.
    resolved = {
      data: [row({ id: "f1", vintage_year: null }), row({ id: "f2", vintage_year: null })],
      error: null,
    };
    const res = await GET(request("http://localhost/api/v1/funds?limit=1"));
    const body = await res.json();

    expect(body.data).toHaveLength(1);
    const decoded = JSON.parse(Buffer.from(body.nextCursor, "base64url").toString("utf8"));
    expect(decoded).toEqual({ v: null, id: "f1" });
  });

  it("returns a well-formed page with no cursor needed when everything fits", async () => {
    resolved = { data: [row()], error: null };
    const res = await GET(request("http://localhost/api/v1/funds"));
    const body = await res.json();

    expect(body.nextCursor).toBeNull();
    expect(body.data[0]).toEqual({
      id: "f1",
      name: "Fund I",
      type: "fund",
      vintage_year: 2024,
      target_size: 100_000_000,
      committed_capital: 90_000_000,
      called_capital: 30_000_000,
      distributed_capital: 5_000_000,
      currency: "USD",
    });
  });
});
