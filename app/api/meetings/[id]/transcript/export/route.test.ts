/** Downloading a transcript: names and corrections applied, in the asked-for format, for those who can read it. */
let rows: unknown[] = [];
let meeting: unknown = { id: "m1", title: "Quarterly call", started_at: "2026-11-06T10:00:00.000Z", created_at: "2026-11-06T09:00:00Z" };

jest.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ ok: true }), clientIp: () => "1.1.1.1", rateLimitHeaders: () => ({}) }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "order", "limit"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: meeting });
      q.range = async () => ({ data: table === "live_meeting_transcripts" ? rows : [], error: null });
      q.then = (resolve: (v: unknown) => unknown) =>
        resolve({
          data:
            table === "live_meeting_speaker_names"
              ? [{ original: "Speaker 2", display: "Dana" }]
              : table === "live_meeting_transcript_edits"
                ? [{ line_id: "b", text: "We close in May." }]
                : [],
          error: null,
        });
      return q;
    },
  }),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const params = Promise.resolve({ id: "m1" });
const get = (qs: string) => new NextRequest(`http://localhost/api/meetings/m1/transcript/export?${qs}`);

beforeEach(() => {
  meeting = { id: "m1", title: "Quarterly call", started_at: "2026-11-06T10:00:00.000Z", created_at: "2026-11-06T09:00:00Z" };
  rows = [
    { id: "a", speaker: "Speaker 1", text: "Where do we close?", ts: "2026-11-06T10:00:02.000Z" },
    { id: "b", speaker: "Speaker 2", text: "We close in March.", ts: "2026-11-06T10:00:06.000Z" },
  ];
});

it("downloads plain text with names and corrections", async () => {
  const res = await GET(get("format=txt"), { params });
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="meeting-transcript-2026-11-06.txt"');
  const text = await res.text();
  expect(text).toContain("[0:06] Dana: We close in May.");
  expect(text).not.toContain("March");
});

it("leaves timestamps out when asked", async () => {
  expect(await (await GET(get("format=txt&timestamps=0"), { params })).text()).toContain("\nDana: We close in May.");
});

it("downloads captions", async () => {
  const res = await GET(get("format=vtt"), { params });
  expect(res.headers.get("Content-Type")).toMatch(/text\/vtt/);
  expect(await res.text()).toMatch(/^WEBVTT\n\n00:00:02.000 --> 00:00:06.000\nSpeaker 1: Where do we close\?/);
});

it("downloads a Word document", async () => {
  const res = await GET(get("format=docx"), { params });
  expect(res.status).toBe(200);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // A .docx is a zip.
  expect([...bytes.subarray(0, 2)]).toEqual([0x50, 0x4b]);
});

it("refuses an unknown format, a missing meeting and an empty transcript", async () => {
  expect((await GET(get("format=pdf"), { params })).status).toBe(400);
  rows = [];
  expect((await GET(get("format=txt"), { params })).status).toBe(404);
  meeting = null;
  expect((await GET(get("format=txt"), { params })).status).toBe(404);
});
