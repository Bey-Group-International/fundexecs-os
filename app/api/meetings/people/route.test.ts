/**
 * The picker's lookup endpoint.
 *
 * Two things are worth pinning: it is org-scoped (the directory of one firm
 * must never leak into another's picker), and it hands back more rows than the
 * dropdown shows so the client can keep narrowing between debounced fetches.
 */
const requireOrgContext = jest.fn();
const loadPeopleDirectory = jest.fn();

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => requireOrgContext() }));
jest.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({}) }));
jest.mock("@/lib/meetings/people.server", () => ({
  loadPeopleDirectory: (...a: unknown[]) => loadPeopleDirectory(...a),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const req = (qs: string) => new NextRequest(`http://localhost/api/meetings/people${qs}`);

beforeEach(() => {
  jest.clearAllMocks();
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "u1" } });
  loadPeopleDirectory.mockResolvedValue([
    { email: "ana@fund.test", name: "Ana Member", source: "member" },
    { email: "ben@out.test", name: "Ben Contact", source: "contact" },
  ]);
});

it("refuses a caller with no organization", async () => {
  requireOrgContext.mockResolvedValue({ ok: false, status: 403, error: "No active organization" });
  const res = await GET(req("?q=a"));
  expect(res.status).toBe(403);
  expect(loadPeopleDirectory).not.toHaveBeenCalled();
});

it("scopes the directory to the caller's own organization", async () => {
  await GET(req("?q=a"));
  expect(loadPeopleDirectory).toHaveBeenCalledWith(expect.anything(), "org1");
});

it("ranks teammates ahead of contacts", async () => {
  const res = await GET(req("?q="));
  const json = (await res.json()) as { results: Array<{ email: string }> };
  expect(json.results.map((r) => r.email)).toEqual(["ana@fund.test", "ben@out.test"]);
});

it("filters by the query", async () => {
  const res = await GET(req("?q=ben"));
  const json = (await res.json()) as { results: Array<{ email: string }> };
  expect(json.results.map((r) => r.email)).toEqual(["ben@out.test"]);
});

it("drops people already on the meeting", async () => {
  const res = await GET(req("?q=&exclude=ana%40fund.test"));
  const json = (await res.json()) as { results: Array<{ email: string }> };
  expect(json.results.map((r) => r.email)).toEqual(["ben@out.test"]);
});

it("ignores case and padding in the exclude list", async () => {
  const res = await GET(req("?q=&exclude=%20ANA%40Fund.test%20%2C"));
  const json = (await res.json()) as { results: Array<{ email: string }> };
  expect(json.results.map((r) => r.email)).toEqual(["ben@out.test"]);
});

it("returns more than the dropdown shows, so the client can keep narrowing", async () => {
  loadPeopleDirectory.mockResolvedValue(
    Array.from({ length: 40 }, (_, i) => ({
      email: `p${String(i).padStart(2, "0")}@fund.test`,
      name: `Person ${i}`,
      source: "member",
    })),
  );
  const res = await GET(req("?q="));
  const json = (await res.json()) as { results: unknown[] };
  expect(json.results).toHaveLength(25);
});

it("answers an empty query with the directory rather than nothing", async () => {
  const res = await GET(req(""));
  const json = (await res.json()) as { results: unknown[] };
  expect(json.results).toHaveLength(2);
});
