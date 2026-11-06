/** A shared clip's timeline: the clip's own parts, only once it has been cut. */
const resolveMock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ hasSupabaseServiceEnv: () => true, createServiceClient: () => ({}) }));
jest.mock("@/lib/meetings/recording-share.server", () => {
  const actual = jest.requireActual("@/lib/meetings/recording-share.server");
  return {
    ...actual,
    resolveShare: (...a: unknown[]) => resolveMock(...a),
    clipTimeline: async () => ({
      parts: [
        { idx: 0, start: 0, end: 500, offsetMs: 0, durationMs: 4000 },
        { idx: 1, start: 500, end: 900, offsetMs: 4000, durationMs: 3000 },
      ],
      paths: new Map(),
    }),
  };
});

import { NextRequest } from "next/server";
import { GET } from "./route";

const params = Promise.resolve({ token: "tok" });
const req = () => new NextRequest("http://localhost/api/clip/tok/parts", { headers: { "x-real-ip": "5.5.5.5" } });
const resolved = (clip_status: string) => ({
  share: { id: "s1", clip_status },
  recording: { mime_type: "video/webm", started_at: "2026-11-06T10:00:00Z" },
  meetingTitle: "Call",
});

it("describes the clip alone, on its own clock", async () => {
  resolveMock.mockResolvedValue(resolved("ready"));
  const res = await GET(req(), { params });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { durationMs: number; totalBytes: number; parts: unknown[] };
  expect(body).toMatchObject({ durationMs: 7000, totalBytes: 900 });
  expect(body.parts).toHaveLength(2);
});

it("answers 409 until the clip has been cut", async () => {
  resolveMock.mockResolvedValue(resolved("pending"));
  const res = await GET(req(), { params });
  expect(res.status).toBe(409);
  expect(res.headers.get("Retry-After")).toBe("30");
});
