/**
 * Playing a recording stitched from its stored parts.
 *
 * What is under test is how much one request carries and how fast it reads.
 * A <video> asks for `bytes=0-` and then reads only as fast as it plays, so an
 * uncapped answer held a function open for the length of the meeting — until
 * the platform killed it at 300 seconds. And parts read strictly one at a
 * time made every download pay a storage round trip per five seconds of video.
 */
const download = jest.fn();
const readAllRecordingParts = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: () => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({
          data: {
            id: "r1", meeting_id: "m1", mime_type: "video/webm",
            status: "complete", deleted_at: null, started_at: "2026-09-01T10:00:00Z",
          },
          error: null,
        }),
      };
      return b;
    },
    storage: { from: () => ({ download: (p: string) => download(p) }) },
  }),
  hasSupabaseServiceEnv: () => false,
  createServiceClient: () => { throw new Error("not used"); },
}));
jest.mock("@/lib/meetings/recording-parts", () => ({
  readAllRecordingParts: (...a: unknown[]) => readAllRecordingParts(...a),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";
import { PLAYBACK_WINDOW_BYTES } from "@/lib/meetings/recording-range";

const PART = 1024 * 1024;
const PARTS = Array.from({ length: 40 }, (_, i) => ({ path: `m1/r1/part-${i}.webm`, size: PART }));
const TOTAL = PART * PARTS.length;

const params = { params: Promise.resolve({ id: "m1", recordingId: "r1" }) };
const get = (range?: string, query = "") =>
  GET(
    new NextRequest(`http://localhost/api/meetings/m1/recording/r1/stream${query}`, {
      headers: range ? { range } : {},
    }),
    params,
  );

beforeEach(() => {
  jest.clearAllMocks();
  readAllRecordingParts.mockResolvedValue(PARTS);
  download.mockImplementation(async () => ({
    data: { arrayBuffer: async () => new ArrayBuffer(PART) },
    error: null,
  }));
});

describe("how much one request carries", () => {
  it("answers a player's open-ended range one window at a time", async () => {
    const res = await get("bytes=0-");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-length")).toBe(String(PLAYBACK_WINDOW_BYTES));
    expect(res.headers.get("content-range")).toBe(`bytes 0-${PLAYBACK_WINDOW_BYTES - 1}/${TOTAL}`);
    expect((await res.arrayBuffer()).byteLength).toBe(PLAYBACK_WINDOW_BYTES);
  });

  it("answers a bounded range exactly, however long", async () => {
    const end = PART * 20 - 1;
    const res = await get(`bytes=0-${end}`);
    expect(res.headers.get("content-range")).toBe(`bytes 0-${end}/${TOTAL}`);
    expect((await res.arrayBuffer()).byteLength).toBe(end + 1);
  });

  it("answers a download whole", async () => {
    const res = await get("bytes=0-", "?download=1");
    expect(res.headers.get("content-length")).toBe(String(TOTAL));
    expect((await res.arrayBuffer()).byteLength).toBe(TOTAL);
  });
});

describe("how fast it reads", () => {
  it("has more than one part in flight at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    download.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return { data: { arrayBuffer: async () => new ArrayBuffer(PART) }, error: null };
    });
    const res = await get(undefined, "?download=1");
    await res.arrayBuffer();
    expect(download).toHaveBeenCalledTimes(PARTS.length);
    expect(peak).toBeGreaterThan(1);
  });
});
