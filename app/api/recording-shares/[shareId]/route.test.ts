/** Revoking a clip link: its creator only, once. */
const authMock = jest.fn();
const calls: Array<{ method: string; args: unknown[] }> = [];
let result: { data: unknown; error: unknown } = { data: [], error: null };

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => {
    const q: Record<string, unknown> = {};
    for (const m of ["update", "eq", "is", "select"]) {
      q[m] = (...args: unknown[]) => {
        calls.push({ method: m, args });
        return q;
      };
    }
    q.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return { from: () => q };
  },
}));

import { NextRequest } from "next/server";
import { PATCH } from "./route";

const params = Promise.resolve({ shareId: "s1" });
const patch = (body: unknown) =>
  new NextRequest("http://localhost/api/recording-shares/s1", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  calls.length = 0;
  authMock.mockReturnValue({ ok: true, ctx: { userId: "u1", orgId: "o1" } });
  result = {
    data: [{ id: "s1", label: null, start_ms: 0, end_ms: 10_000, expires_at: "2026-11-13T00:00:00Z", revoked_at: "2026-11-06T00:00:00Z", open_count: 3, last_opened_at: null, created_at: "2026-11-01T00:00:00Z" }],
    error: null,
  };
});

it("revokes the caller's own live link", async () => {
  const res = await PATCH(patch({ revoke: true }), { params });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { share: { revokedAt: string } }).share.revokedAt).toBeTruthy();
  expect(calls).toContainEqual({ method: "eq", args: ["created_by", "u1"] });
  expect(calls).toContainEqual({ method: "is", args: ["revoked_at", null] });
});

it("answers 404 when nothing of the caller's matched", async () => {
  result = { data: [], error: null };
  expect((await PATCH(patch({ revoke: true }), { params })).status).toBe(404);
});

it("refuses a body that asks for nothing", async () => {
  expect((await PATCH(patch({}), { params })).status).toBe(400);
  expect(calls).toEqual([]);
});
