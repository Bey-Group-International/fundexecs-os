/**
 * A shared clip's bytes: only the clip's own parts (cut on the server), never
 * the recording's; downloads only where the link allows them.
 */
const resolveMock = jest.fn();
const recordView = jest.fn(async () => {});
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
jest.mock("@/lib/meetings/recording-share.server", () => {
  const actual = jest.requireActual("@/lib/meetings/recording-share.server");
  return {
    ...actual,
    resolveShare: (...a: unknown[]) => resolveMock(...a),
    recordView: (...a: unknown[]) => recordView(...(a as [])),
    // Four clip parts of 100 bytes, five seconds each.
    clipTimeline: async () => ({
      parts: Array.from({ length: 4 }, (_, i) => ({ idx: i, start: i * 100, end: (i + 1) * 100, offsetMs: i * 5000, durationMs: 5000 })),
      paths: new Map(Array.from({ length: 4 }, (_, i) => [i, `m1/r1/clip-s1-part-00000${i}.webm`])),
    }),
  };
});

import { NextRequest } from "next/server";
import { GET } from "./route";
import { clearRateLimitBucketsForTests } from "@/lib/rate-limit";
import { clearClipGuardsForTests } from "@/lib/meetings/recording-share.server";

const params = Promise.resolve({ token: "tok" });
function req(opts: { range?: string; download?: boolean; ip?: string } = {}) {
  const headers: Record<string, string> = { "x-real-ip": opts.ip ?? "1.2.3.4" };
  if (opts.range) headers.range = opts.range;
  return new NextRequest(`http://localhost/api/clip/tok/stream${opts.download ? "?download=1" : ""}`, { headers });
}
function share(extra: Record<string, unknown> = {}) {
  return {
    share: { id: "s1", recording_id: "r1", start_ms: 20_000, end_ms: 30_000, clip_status: "ready", allow_download: false, ...extra },
    recording: { mime_type: "video/webm", started_at: "2026-11-06T10:00:00Z" },
    meetingTitle: "Call",
  };
}

beforeEach(() => {
  downloads.length = 0;
  recordView.mockClear();
  clearRateLimitBucketsForTests();
  clearClipGuardsForTests();
  resolveMock.mockResolvedValue(share());
});

it("serves a range of the clip's own parts", async () => {
  const res = await GET(req({ range: "bytes=100-299" }), { params });
  expect(res.status).toBe(206);
  expect(res.headers.get("Content-Range")).toBe("bytes 100-299/400");
  await res.arrayBuffer();
  expect(downloads).toEqual(["m1/r1/clip-s1-part-000001.webm", "m1/r1/clip-s1-part-000002.webm"]);
  expect(res.headers.get("Content-Disposition")).toBe("inline");
});

it("serves the whole clip for a plain request, and nothing of the recording", async () => {
  const res = await GET(req(), { params });
  expect(res.status).toBe(200);
  expect((await res.arrayBuffer()).byteLength).toBe(400);
  expect(downloads.every((p) => p.includes("/clip-s1-"))).toBe(true);
});

it("refuses a download the link does not allow", async () => {
  const res = await GET(req({ download: true }), { params });
  expect(res.status).toBe(403);
  expect(downloads).toEqual([]);
});

it("serves a download as an attachment when allowed, and logs it", async () => {
  resolveMock.mockResolvedValue(share({ allow_download: true }));
  const res = await GET(req({ download: true, range: "bytes=0-99" }), { params });
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="meeting-clip-2026-11-06.webm"');
  expect(res.headers.get("Content-Length")).toBe("400");
  expect(recordView).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: "s1" }), { ip: "1.2.3.4", userAgent: null }, "download");
});

it("answers 409 while the clip is being cut", async () => {
  resolveMock.mockResolvedValue(share({ clip_status: "processing" }));
  expect((await GET(req({ range: "bytes=0-99" }), { params })).status).toBe(409);
  expect(downloads).toEqual([]);
});

it("says gone for an expired link and not found for a bad one", async () => {
  resolveMock.mockResolvedValue({ failure: "expired" });
  expect((await GET(req({ range: "bytes=0-99" }), { params })).status).toBe(410);
  resolveMock.mockResolvedValue({ failure: "not_found" });
  expect((await GET(req({ range: "bytes=0-99" }), { params })).status).toBe(404);
});

it("stops an address that keeps guessing tokens", async () => {
  resolveMock.mockResolvedValue({ failure: "not_found" });
  for (let i = 0; i < 10; i++) await GET(req({ ip: "9.9.9.9" }), { params });
  resolveMock.mockResolvedValue(share());
  // Even a good token is refused for a while after that.
  expect((await GET(req({ ip: "9.9.9.9", range: "bytes=0-99" }), { params })).status).toBe(429);
  // Another address is unaffected.
  expect((await GET(req({ ip: "8.8.8.8", range: "bytes=0-99" }), { params })).status).toBe(206);
});
