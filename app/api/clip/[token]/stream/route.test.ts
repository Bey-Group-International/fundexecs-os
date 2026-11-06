/**
 * A shared clip's bytes: only Range requests wholly inside the clip's parts.
 */
const resolveMock = jest.fn();
const downloads: string[] = [];

jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({
    storage: {
      from: () => ({
        download: async (path: string) => {
          downloads.push(path);
          return { data: new Blob([new Uint8Array(100).fill(7)]), error: null };
        },
      }),
    },
  }),
}));
jest.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ ok: true }),
  clientIp: () => "1.2.3.4",
  rateLimitHeaders: () => ({}),
}));
jest.mock("@/lib/meetings/recording-share.server", () => ({ resolveShare: (...a: unknown[]) => resolveMock(...a) }));
jest.mock("@/lib/meetings/recording-parts", () => ({
  readAllRecordingParts: async () =>
    Array.from({ length: 10 }, (_, i) => ({ idx: i, path: `r1/${i}.webm`, size: 100, offset_ms: i * 5000, duration_ms: 5000 })),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const params = Promise.resolve({ token: "tok" });
function req(range?: string) {
  return new NextRequest("http://localhost/api/clip/tok/stream", { headers: range ? { range } : {} });
}

beforeEach(() => {
  downloads.length = 0;
  resolveMock.mockResolvedValue({
    share: { recording_id: "r1", start_ms: 20_000, end_ms: 30_000 },
    recording: { mime_type: "video/webm", started_at: "2026-11-06T10:00:00Z" },
    meetingTitle: "Call",
  });
});

it("serves a range inside the clip", async () => {
  const res = await GET(req("bytes=300-699"), { params });
  expect(res.status).toBe(206);
  expect(res.headers.get("Content-Range")).toBe("bytes 300-699/1000");
  expect(downloads).toEqual(["r1/3.webm", "r1/4.webm", "r1/5.webm", "r1/6.webm"]);
});

it("serves the header part", async () => {
  expect((await GET(req("bytes=0-99"), { params })).status).toBe(206);
});

it("refuses a range reaching outside the clip", async () => {
  const res = await GET(req("bytes=0-999"), { params });
  expect(res.status).toBe(403);
  expect(downloads).toEqual([]);
});

it("refuses a request with no range", async () => {
  expect((await GET(req(), { params })).status).toBe(416);
});

it("says gone for an expired or revoked link, and not found for a bad one", async () => {
  resolveMock.mockResolvedValueOnce({ failure: "expired" });
  expect((await GET(req("bytes=0-99"), { params })).status).toBe(410);
  resolveMock.mockResolvedValueOnce({ failure: "not_found" });
  expect((await GET(req("bytes=0-99"), { params })).status).toBe(404);
});
