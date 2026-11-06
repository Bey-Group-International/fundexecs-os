/** Correcting a line: host only, this meeting's lines only, original kept, undone by sending nothing. */
const access = jest.fn();
const ops: Array<{ op: string; args: unknown[] }> = [];
let line: unknown = { id: "11111111-1111-4111-8111-111111111111", text: "We close in March." };

jest.mock("../../../follow-up/host.server", () => ({ requireMeetingHost: (...a: unknown[]) => access(...a) }));

import { NextRequest } from "next/server";
import { PUT } from "./route";

const LINE = "11111111-1111-4111-8111-111111111111";
function db() {
  return {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "upsert", "delete", "eq"]) {
        q[m] = (...args: unknown[]) => {
          ops.push({ op: `${table}.${m}`, args });
          return q;
        };
      }
      q.maybeSingle = async () => ({ data: line });
      q.then = (resolve: (v: unknown) => unknown) => resolve({ error: null });
      return q;
    },
  };
}
const params = (lineId = LINE) => Promise.resolve({ id: "m1", lineId });
const put = (body: unknown) =>
  new NextRequest(`http://localhost/api/meetings/m1/transcript/lines/${LINE}`, { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => {
  ops.length = 0;
  line = { id: LINE, text: "We close in March." };
  access.mockResolvedValue({ ok: true, userId: "u1", db: db() });
});

it("stores a correction beside the line, and says what was heard", async () => {
  const res = await PUT(put({ text: "We close in May." }), { params: params() });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ lineId: LINE, text: "We close in May.", original: "We close in March." });
  expect(ops).toContainEqual({ op: "live_meeting_transcripts.eq", args: ["meeting_id", "m1"] });
  expect(ops.find((o) => o.op === "live_meeting_transcript_edits.upsert")!.args[0]).toMatchObject({ line_id: LINE, meeting_id: "m1", text: "We close in May.", edited_by: "u1" });
  // The line itself is never written.
  expect(ops.some((o) => o.op.startsWith("live_meeting_transcripts.") && o.op !== "live_meeting_transcripts.select" && o.op !== "live_meeting_transcripts.eq")).toBe(false);
});

it("undoes a correction when sent nothing, or the original", async () => {
  for (const text of [null, "We close in March."]) {
    const res = await PUT(put({ text }), { params: params() });
    expect(await res.json()).toEqual({ lineId: LINE, text: "We close in March.", original: null });
  }
  expect(ops.filter((o) => o.op === "live_meeting_transcript_edits.delete")).toHaveLength(2);
});

it("will not touch another meeting's line, or a malformed id", async () => {
  line = null;
  expect((await PUT(put({ text: "x" }), { params: params() })).status).toBe(404);
  expect((await PUT(put({ text: "x" }), { params: params("not-a-uuid") })).status).toBe(404);
  expect(ops.some((o) => o.op.startsWith("live_meeting_transcript_edits"))).toBe(false);
});
