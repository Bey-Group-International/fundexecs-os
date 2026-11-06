const authMock = jest.fn();
const inserts: unknown[] = [];
let count = 0;
jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => {
  const client = {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
      q.then = (resolve: (v: unknown) => unknown) => resolve({ count, data: [{ id: "t1", name: "LP update", body: "Hi" }], error: null });
      q.insert = (row: unknown) => (inserts.push(row), { select: () => ({ single: async () => ({ data: { id: "t2", ...(row as object) }, error: null }) }) });
      return q;
    },
  };
  return { hasSupabaseServiceEnv: () => true, createServiceClient: () => client, createServerClient: async () => client };
});

import { NextRequest } from "next/server";
import { GET, POST } from "./route";

const post = (body: unknown) => new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  inserts.length = 0;
  count = 0;
  authMock.mockResolvedValue({ ok: true, ctx: { userId: "u1", orgId: "o1", role: "member" } });
});

it("lists the firm's templates", async () => {
  expect((await (await GET()).json()).templates).toHaveLength(1);
});

it("saves a cleaned template", async () => {
  expect((await POST(post({ name: "  Intro call ", body: "Hi {{first_name}}" }))).status).toBe(200);
  expect(inserts[0]).toEqual({ organization_id: "o1", name: "Intro call", body: "Hi {{first_name}}", created_by: "u1" });
});

it("refuses a viewer, an empty template and a full set", async () => {
  authMock.mockResolvedValue({ ok: true, ctx: { userId: "u1", orgId: "o1", role: "viewer" } });
  expect((await POST(post({ name: "x", body: "y" }))).status).toBe(403);
  authMock.mockResolvedValue({ ok: true, ctx: { userId: "u1", orgId: "o1", role: "member" } });
  expect((await POST(post({ name: "x", body: "" }))).status).toBe(400);
  count = 50;
  expect((await POST(post({ name: "x", body: "y" }))).status).toBe(409);
});
