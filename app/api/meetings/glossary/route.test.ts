/** The firm's glossary: members read, writers add and remove. */
const authMock = jest.fn();
const inserts: unknown[] = [];
let insertResult: { data: unknown; error: unknown };
let count = 0;

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => {
  const client = {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
      q.then = (resolve: (v: unknown) => unknown) => resolve({ count, data: [{ id: "t1", term: "LPAC" }], error: null });
      q.insert = (row: unknown) => {
        inserts.push(row);
        return { select: () => ({ single: async () => insertResult }) };
      };
      return q;
    },
  };
  return { hasSupabaseServiceEnv: () => true, createServiceClient: () => client, createServerClient: async () => client };
});

import { NextRequest } from "next/server";
import { GET, POST } from "./route";

const post = (body: unknown) =>
  new NextRequest("http://localhost/api/meetings/glossary", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  inserts.length = 0;
  count = 0;
  insertResult = { data: { id: "t2", term: "Dunbar Capital" }, error: null };
  authMock.mockResolvedValue({ ok: true, ctx: { userId: "u1", orgId: "o1", role: "member" } });
});

it("lists the firm's terms", async () => {
  expect(await (await GET()).json()).toEqual({ terms: [{ id: "t1", term: "LPAC" }] });
});

it("adds a cleaned term", async () => {
  const res = await POST(post({ term: "  Dunbar   Capital " }));
  expect(res.status).toBe(200);
  expect(inserts[0]).toEqual({ organization_id: "o1", term: "Dunbar Capital", created_by: "u1" });
});

it("refuses a viewer, a bad term, a duplicate and a full glossary", async () => {
  authMock.mockResolvedValue({ ok: true, ctx: { userId: "u1", orgId: "o1", role: "viewer" } });
  expect((await POST(post({ term: "LPAC" }))).status).toBe(403);
  authMock.mockResolvedValue({ ok: true, ctx: { userId: "u1", orgId: "o1", role: "member" } });
  expect((await POST(post({ term: "x" }))).status).toBe(400);
  insertResult = { data: null, error: { code: "23505" } };
  expect((await POST(post({ term: "LPAC" }))).status).toBe(409);
  count = 200;
  expect((await POST(post({ term: "New" }))).status).toBe(409);
});
