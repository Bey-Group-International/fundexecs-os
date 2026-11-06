/** Live notes: one shared copy, rewritten only when enough has been said. */
const callerMock = jest.fn();
const createMock = jest.fn();
const updates: unknown[] = [];
let meetingRow: { data: unknown; error: unknown };
let rows: unknown[] = [];

jest.mock("@/lib/meetings/meeting-access.server", () => ({ authorizeMeetingCaller: (...a: unknown[]) => callerMock(...a) }));
jest.mock("@/lib/anthropic-client", () => ({ anthropicClient: () => ({ messages: { create: createMock } }), INTERACTIVE_TIMEOUT_MS: 1 }));
jest.mock("@/lib/meetings/report-generation.server", () => ({ readStoredTranscriptRows: async () => rows }));
jest.mock("@/lib/supabase/server", () => {
  const client = {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
      q.maybeSingle = async () => meetingRow;
      q.then = (resolve: (v: unknown) => unknown) => resolve(table === "meeting_glossary_terms" ? { data: [{ term: "LPAC" }], error: null } : { data: null, error: null });
      q.update = (row: unknown) => {
        updates.push(row);
        return { eq: async () => ({ error: null }) };
      };
      return q;
    },
  };
  return { hasSupabaseServiceEnv: () => true, createServiceClient: () => client, createServerClient: async () => client };
});

import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { clearRateLimitBucketsForTests } from "@/lib/rate-limit";

const params = Promise.resolve({ id: "m1" });
const post = (body: unknown = {}) =>
  new NextRequest("http://localhost/api/meetings/m1/live-notes", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const line = (i: number) => ({ speaker: "Ana", text: `the l p a c point ${i}`, ts: new Date(1_700_000_000_000 + i * 1000).toISOString(), confidence: 0.9, overlapped: false });

function meeting(overrides: Record<string, unknown> = {}) {
  return { data: { id: "m1", title: "Call", host_id: "host", organization_id: "o1", status: "live", started_at: null, notetaker: {}, live_notes: null, ...overrides }, error: null };
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test";
  clearRateLimitBucketsForTests();
  updates.length = 0;
  createMock.mockReset();
  createMock.mockResolvedValue({
    content: [{ type: "tool_use", input: { summary: "Discussing the LPAC.", key_points: ["LPAC timing"], decisions: [], action_items: ["Ana: send deck"] } }],
  });
  callerMock.mockResolvedValue({ ok: true, userId: "u2" });
  meetingRow = meeting();
  rows = Array.from({ length: 8 }, (_, i) => line(i));
});

it("writes notes once enough has been said, from the glossary-corrected transcript", async () => {
  const res = await POST(post(), { params });
  const body = await res.json();
  expect(body.fresh).toBe(true);
  expect(body.notes.action_items).toEqual(["Ana: send deck"]);
  expect(body.notes.lines).toBe(8);
  const prompt = createMock.mock.calls[0][0].messages[0].content as string;
  expect(prompt).toContain("the LPAC point 3");
  expect(prompt).toContain("spell them exactly so): LPAC");
  expect(updates).toHaveLength(1);
});

it("hands back the stored notes when too little is new", async () => {
  meetingRow = meeting({ live_notes: { summary: "Old", key_points: [], decisions: [], action_items: [], generatedAt: Date.now() - 120_000, lines: 6 } });
  const body = await (await POST(post(), { params })).json();
  expect(body.fresh).toBe(false);
  expect(body.notes.summary).toBe("Old");
  expect(createMock).not.toHaveBeenCalled();
});

it("writes nothing while the notetaker is paused", async () => {
  meetingRow = meeting({ notetaker: { paused: true } });
  const body = await (await POST(post(), { params })).json();
  expect(body.paused).toBe(true);
  expect(createMock).not.toHaveBeenCalled();
});

it("keeps the notes from everyone but the host when the host says so", async () => {
  meetingRow = meeting({ notetaker: { notesVisibility: "host" } });
  expect((await GET(new NextRequest("http://localhost/x"), { params })).status).toBe(403);
  callerMock.mockResolvedValue({ ok: true, userId: "host" });
  expect((await GET(new NextRequest("http://localhost/x"), { params })).status).toBe(200);
});

it("keeps the old notes when the model fails", async () => {
  createMock.mockRejectedValue(new Error("down"));
  const body = await (await POST(post(), { params })).json();
  expect(body.fresh).toBe(false);
  expect(updates).toEqual([]);
});

it("refuses a stranger", async () => {
  callerMock.mockResolvedValue({ ok: false, userId: null });
  expect((await POST(post(), { params })).status).toBe(401);
});
