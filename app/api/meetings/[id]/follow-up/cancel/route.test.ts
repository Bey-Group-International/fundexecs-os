const hostMock = jest.fn();
const calls: Array<[string, unknown[]]> = [];
jest.mock("../host.server", () => ({ requireMeetingHost: () => hostMock() }));

import { NextRequest } from "next/server";
import { POST } from "./route";

beforeEach(() => {
  calls.length = 0;
  const q: Record<string, unknown> = {};
  for (const m of ["update", "eq", "in"]) q[m] = (...a: unknown[]) => (calls.push([m, a]), q);
  q.select = async () => ({ data: [{ id: "s1" }], error: null });
  hostMock.mockResolvedValue({ ok: true, db: { from: () => q } });
});

const post = (body: unknown) => new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify(body) });

it("cancels only this meeting's scheduled sends", async () => {
  const body = await (await POST(post({}), { params: Promise.resolve({ id: "m1" }) })).json();
  expect(body.cancelled).toBe(1);
  expect(calls).toContainEqual(["eq", ["meeting_id", "m1"]]);
  expect(calls).toContainEqual(["eq", ["status", "scheduled"]]);
  expect(calls.find(([m]) => m === "in")).toBeUndefined();
});

it("cancels just the ones named", async () => {
  await POST(post({ ids: ["s1", 5] }), { params: Promise.resolve({ id: "m1" }) });
  expect(calls).toContainEqual(["in", ["id", ["s1"]]]);
});
