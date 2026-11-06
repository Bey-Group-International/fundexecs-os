/**
 * Renaming a recorded call: only the caller's own, never an empty name.
 */
const authMock = jest.fn();
const calls: Array<{ method: string; args: unknown[] }> = [];
let result: { data: unknown; error: unknown } = { data: [{ id: "c1" }], error: null };

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
    // Not the thenable itself: awaiting the client would resolve it.
    return { from: (...args: unknown[]) => { calls.push({ method: "from", args }); return q; } };
  },
}));

import { NextRequest } from "next/server";
import { PATCH } from "./route";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/meetings/calls/c1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = Promise.resolve({ id: "c1" });

beforeEach(() => {
  calls.length = 0;
  result = { data: [{ id: "c1" }], error: null };
  authMock.mockReturnValue({ ok: true, ctx: { userId: "u1", orgId: "o1" } });
});

it("renames the caller's own call, cleaned", async () => {
  const res = await PATCH(req({ title: "  Dunbar   follow-up " }), { params });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: "c1", title: "Dunbar follow-up" });
  expect(calls).toContainEqual({ method: "update", args: [{ title: "Dunbar follow-up" }] });
  expect(calls).toContainEqual({ method: "eq", args: ["host_id", "u1"] });
  expect(calls).toContainEqual({ method: "eq", args: ["organization_id", "o1"] });
  expect(calls).toContainEqual({ method: "eq", args: ["kind", "one_way"] });
});

it("refuses an empty name", async () => {
  const res = await PATCH(req({ title: "   " }), { params });
  expect(res.status).toBe(400);
  expect(calls).toEqual([]);
});

it("answers 404 when no row of the caller's matched", async () => {
  result = { data: [], error: null };
  expect((await PATCH(req({ title: "Name" }), { params })).status).toBe(404);
});

it("requires a signed-in member", async () => {
  authMock.mockReturnValue({ ok: false, error: "Unauthorized", status: 401 });
  expect((await PATCH(req({ title: "Name" }), { params })).status).toBe(401);
});

describe("organising", () => {
  it("stores cleaned tags and who was on the call, and nothing else", async () => {
    const res = await PATCH(req({ tags: "#LP, lp, diligence", people: "Ana Ruiz; Bo" }), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "c1", tags: ["LP", "diligence"], people: ["Ana Ruiz", "Bo"] });
    expect(calls).toContainEqual({
      method: "update",
      args: [{ tags: ["LP", "diligence"], attendees: [{ name: "Ana Ruiz", type: "external" }, { name: "Bo", type: "external" }] }],
    });
  });

  it("unlinks a deal with null, and refuses something that is not a deal id", async () => {
    expect(await (await PATCH(req({ dealId: null }), { params })).json()).toEqual({ id: "c1", dealId: null, dealName: null });
    expect((await PATCH(req({ dealId: "drop table" }), { params })).status).toBe(400);
  });

  it("refuses a request that changes nothing", async () => {
    expect((await PATCH(req({}), { params })).status).toBe(400);
  });
});
