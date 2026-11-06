/** Bookmarks: your own, never in the future, capped per person. */
const callerMock = jest.fn();
const inserts: unknown[] = [];
let count = 0;
let insertResult: { data: unknown; error: unknown };

jest.mock("@/lib/meetings/meeting-access.server", () => ({ authorizeMeetingCaller: (...a: unknown[]) => callerMock(...a) }));
jest.mock("@/lib/supabase/server", () => {
  const client = {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
      q.then = (resolve: (v: unknown) => unknown) => resolve({ count, data: [], error: null });
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
import { POST } from "./route";

const params = Promise.resolve({ id: "m1" });
const post = (body: unknown) =>
  new NextRequest("http://localhost/api/meetings/m1/bookmarks", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  inserts.length = 0;
  count = 0;
  insertResult = { data: { id: "b1", at: "2026-11-06T10:00:00Z", label: "Pricing" }, error: null };
  callerMock.mockResolvedValue({ ok: true, userId: "u1" });
});

it("saves a bookmark for the caller", async () => {
  const at = new Date(Date.now() - 30_000).toISOString();
  const res = await POST(post({ at, label: "  Pricing\n " }), { params });
  expect(res.status).toBe(200);
  expect(inserts[0]).toEqual({ meeting_id: "m1", user_id: "u1", at, label: "Pricing" });
});

it("reads a moment in the future as now", async () => {
  const before = Date.now();
  await POST(post({ at: new Date(Date.now() + 10 * 60_000).toISOString() }), { params });
  const at = Date.parse((inserts[0] as { at: string }).at);
  expect(at).toBeGreaterThanOrEqual(before);
  expect(at).toBeLessThanOrEqual(Date.now());
});

it("refuses a guest, and the hundred-and-first", async () => {
  callerMock.mockResolvedValue({ ok: true, userId: null });
  expect((await POST(post({}), { params })).status).toBe(401);
  callerMock.mockResolvedValue({ ok: true, userId: "u1" });
  count = 100;
  expect((await POST(post({}), { params })).status).toBe(409);
});

it("answers 503 before the table exists", async () => {
  insertResult = { data: null, error: { code: "42P01" } };
  expect((await POST(post({}), { params })).status).toBe(503);
});
