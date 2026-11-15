/** Saying who spoke lines on a shared microphone: host only, this meeting's lines only, undone by sending nothing. */
const access = jest.fn();
const ops: Array<{ op: string; args: unknown[] }> = [];
let found: Array<{ id: string; speaker: string | null }> = [];
let writeError: unknown = null;

jest.mock("../../follow-up/host.server", () => ({ requireMeetingHost: (...a: unknown[]) => access(...a) }));

import { NextRequest } from "next/server";
import { PUT } from "./route";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
function db() {
  return {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "upsert", "delete", "eq", "in"]) {
        q[m] = (...args: unknown[]) => {
          ops.push({ op: `${table}.${m}`, args });
          return q;
        };
      }
      q.then = (resolve: (v: unknown) => unknown) =>
        resolve(table === "live_meeting_transcripts" ? { data: found } : { error: writeError });
      return q;
    },
  };
}
const params = Promise.resolve({ id: "m1" });
const put = (body: unknown) =>
  new NextRequest("http://localhost/api/meetings/m1/transcript/line-speakers", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => {
  ops.length = 0;
  writeError = null;
  found = [{ id: A, speaker: "Priya (host)" }, { id: B, speaker: "Priya (host)" }];
  access.mockResolvedValue({ ok: true, userId: "u1", db: db() });
});

it("names who spoke the lines, beside them, without touching the lines", async () => {
  const res = await PUT(put({ lineIds: [A, B], speaker: "  Marcus   Lee " }), { params });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ lineIds: [A, B], speaker: "Marcus Lee", heard: { [A]: "Priya (host)", [B]: "Priya (host)" } });
  const upsert = ops.find((o) => o.op === "live_meeting_line_speakers.upsert")!;
  expect(upsert.args[0]).toMatchObject([
    { line_id: A, meeting_id: "m1", speaker: "Marcus Lee", assigned_by: "u1" },
    { line_id: B, meeting_id: "m1", speaker: "Marcus Lee", assigned_by: "u1" },
  ]);
  expect(ops).toContainEqual({ op: "live_meeting_transcripts.eq", args: ["meeting_id", "m1"] });
  expect(ops.some((o) => o.op === "live_meeting_transcripts.upsert" || o.op === "live_meeting_transcripts.delete")).toBe(false);
});

it("undoes the assignment when sent nothing, or the speaker as heard", async () => {
  found = [{ id: A, speaker: "Priya (host)" }];
  for (const speaker of [null, "", "Priya (host)"]) {
    ops.length = 0;
    const res = await PUT(put({ lineIds: [A], speaker }), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lineIds: [A], speaker: null, heard: { [A]: "Priya (host)" } });
    expect(ops.some((o) => o.op === "live_meeting_line_speakers.delete")).toBe(true);
    expect(ops.some((o) => o.op === "live_meeting_line_speakers.upsert")).toBe(false);
  }
});

it("refuses lines that are not this meeting's, malformed ids, and nothing to assign", async () => {
  found = [{ id: A, speaker: "x" }];
  expect((await PUT(put({ lineIds: [A, B], speaker: "Sam" }), { params })).status).toBe(404);
  expect((await PUT(put({ lineIds: [A, "nope"], speaker: "Sam" }), { params })).status).toBe(400);
  expect((await PUT(put({ lineIds: [], speaker: "Sam" }), { params })).status).toBe(400);
  expect((await PUT(put({ lineIds: [A], speaker: 42 }), { params })).status).toBe(422);
  expect(ops.some((o) => o.op.startsWith("live_meeting_line_speakers"))).toBe(false);
});

it("is for the host only", async () => {
  const { NextResponse } = await import("next/server");
  access.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
  expect((await PUT(put({ lineIds: [A], speaker: "Sam" }), { params })).status).toBe(403);
  expect(ops).toHaveLength(0);
});

it("says so plainly when the table is not there yet", async () => {
  writeError = { code: "42P01" };
  found = [{ id: A, speaker: "Priya (host)" }];
  const res = await PUT(put({ lineIds: [A], speaker: "Sam" }), { params });
  expect(res.status).toBe(503);
});
