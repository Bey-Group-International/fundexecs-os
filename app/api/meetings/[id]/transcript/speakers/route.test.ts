/** Naming a speaker: host only, stored beside the label as heard, cleared by an empty name. */
const access = jest.fn();
const ops: Array<{ op: string; args: unknown[] }> = [];
let result: { error: unknown } = { error: null };

jest.mock("../../follow-up/host.server", () => ({ requireMeetingHost: (...a: unknown[]) => access(...a) }));

import { NextRequest, NextResponse } from "next/server";
import { PUT } from "./route";

function db() {
  const q: Record<string, unknown> = {};
  for (const m of ["upsert", "delete", "eq"]) {
    q[m] = (...args: unknown[]) => {
      ops.push({ op: m, args });
      return q;
    };
  }
  q.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return { from: () => q };
}
const params = Promise.resolve({ id: "m1" });
const put = (body: unknown) =>
  new NextRequest("http://localhost/api/meetings/m1/transcript/speakers", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => {
  ops.length = 0;
  result = { error: null };
  access.mockResolvedValue({ ok: true, userId: "u1", db: db() });
});

it("saves a name for a label", async () => {
  const res = await PUT(put({ original: "Speaker 2", display: "  Dana  Okafor " }), { params });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ original: "Speaker 2", display: "Dana Okafor" });
  expect(ops[0]).toMatchObject({ op: "upsert", args: [expect.objectContaining({ meeting_id: "m1", original: "Speaker 2", display: "Dana Okafor", updated_by: "u1" }), { onConflict: "meeting_id,original" }] });
});

it("clears the name when it is emptied or set back to the label", async () => {
  await PUT(put({ original: "Speaker 2", display: null }), { params });
  await PUT(put({ original: "Speaker 2", display: "Speaker 2" }), { params });
  expect(ops.filter((o) => o.op === "delete")).toHaveLength(2);
  expect(ops.some((o) => o.op === "upsert")).toBe(false);
});

it("refuses anyone but the host, and nonsense", async () => {
  access.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "no" }, { status: 403 }) });
  expect((await PUT(put({ original: "Speaker 2", display: "X" }), { params })).status).toBe(403);
  access.mockResolvedValue({ ok: true, userId: "u1", db: db() });
  expect((await PUT(put({ display: "X" }), { params })).status).toBe(400);
  expect((await PUT(put({ original: "Speaker 2", display: "   " }), { params })).status).toBe(422);
  expect(ops).toEqual([]);
});

it("answers 503 before the table exists", async () => {
  result = { error: { code: "42P01" } };
  expect((await PUT(put({ original: "Speaker 2", display: "Dana" }), { params })).status).toBe(503);
});
