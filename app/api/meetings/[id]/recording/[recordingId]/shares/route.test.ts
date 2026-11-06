/**
 * Making a clip link: host only, a window inside the recording, the token
 * returned once and stored only as a hash, and the clip cut on the server
 * after the response.
 */
const authMock = jest.fn();
const afterCalls: Array<() => unknown> = [];
const buildClip = jest.fn(async () => ({ ok: true }));
let serviceEnv = true;
jest.mock("next/server", () => ({
  ...jest.requireActual("next/server"),
  after: (fn: () => unknown) => afterCalls.push(fn),
}));
jest.mock("@/lib/meetings/recording-clip.server", () => ({ buildClip: (...a: unknown[]) => buildClip(...(a as [])) }));
const inserts: unknown[] = [];
let tables: Record<string, { data: unknown; error: unknown }> = {};

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/meetings/recording-parts", () => ({
  readAllRecordingParts: async () =>
    Array.from({ length: 12 }, (_, i) => ({ idx: i, size: 100, offset_ms: i * 5000, duration_ms: 5000 })),
}));
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => serviceEnv,
  createServiceClient: () => ({ service: true }),
  createServerClient: async () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
      q.insert = (row: unknown) => {
        inserts.push(row);
        return q;
      };
      q.maybeSingle = async () => tables[table];
      q.single = async () => tables[`${table}:insert`];
      q.then = (resolve: (v: unknown) => unknown) => resolve(tables[table]);
      return q;
    },
  }),
}));

import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { hashShareToken } from "@/lib/meetings/recording-share.server";

const params = Promise.resolve({ id: "m1", recordingId: "r1" });
function post(body: unknown) {
  return new NextRequest("http://localhost/api/meetings/m1/recording/r1/shares", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const SHARE_ROW = {
  id: "s1",
  label: "Pricing",
  start_ms: 10_000,
  end_ms: 40_000,
  expires_at: "2026-11-13T00:00:00Z",
  revoked_at: null,
  open_count: 0,
  last_opened_at: null,
  created_at: "2026-11-06T00:00:00Z",
};

beforeEach(() => {
  inserts.length = 0;
  afterCalls.length = 0;
  buildClip.mockClear();
  serviceEnv = true;
  authMock.mockReturnValue({ ok: true, ctx: { userId: "u1", orgId: "o1" } });
  tables = {
    live_meetings: { data: { id: "m1", organization_id: "o1" }, error: null },
    live_meeting_recordings: { data: { id: "r1", deleted_at: null, mime_type: "video/webm;codecs=vp9,opus" }, error: null },
    "recording_shares:insert": { data: SHARE_ROW, error: null },
    recording_shares: { data: [SHARE_ROW], error: null },
  };
});

it("makes a link for the host, storing only the token's hash", async () => {
  const res = await POST(post({ startMs: 10_000, endMs: 40_000, label: " Pricing ", days: 7 }), { params });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { url: string; share: { id: string } };
  expect(body.share.id).toBe("s1");
  const token = body.url.split("/s/clip/")[1];
  expect(token).toBeTruthy();
  const row = inserts[0] as Record<string, unknown>;
  expect(row.token_hash).toBe(hashShareToken(token));
  expect(JSON.stringify(row)).not.toContain(token);
  expect(row).toMatchObject({ meeting_id: "m1", recording_id: "r1", created_by: "u1", label: "Pricing", start_ms: 10_000, end_ms: 40_000 });
  // Streaming only unless asked.
  expect(row.allow_download).toBe(false);
});

it("cuts the clip after answering", async () => {
  await POST(post({ startMs: 10_000, endMs: 40_000 }), { params });
  expect(buildClip).not.toHaveBeenCalled();
  expect(afterCalls).toHaveLength(1);
  await afterCalls[0]();
  expect(buildClip).toHaveBeenCalledWith({ service: true }, "s1");
});

it("stores the download switch when asked", async () => {
  await POST(post({ startMs: 10_000, endMs: 40_000, allowDownload: true }), { params });
  expect((inserts[0] as Record<string, unknown>).allow_download).toBe(true);
});

it("refuses a recording it cannot cut, before making a link", async () => {
  tables.live_meeting_recordings = { data: { id: "r1", deleted_at: null, mime_type: "video/mp4" }, error: null };
  const res = await POST(post({ startMs: 0, endMs: 10_000 }), { params });
  expect(res.status).toBe(422);
  expect(((await res.json()) as { error: string }).error).toMatch(/WebM/);
  expect(inserts).toEqual([]);
});

it("makes no link it could never cut", async () => {
  serviceEnv = false;
  expect((await POST(post({ startMs: 0, endMs: 10_000 }), { params })).status).toBe(503);
  expect(inserts).toEqual([]);
});

it("refuses anyone but the host", async () => {
  tables.live_meetings = { data: null, error: null };
  expect((await POST(post({ startMs: 0, endMs: 10_000 }), { params })).status).toBe(403);
  expect(inserts).toEqual([]);
});

it("says gone for a deleted recording", async () => {
  tables.live_meeting_recordings = { data: { id: "r1", deleted_at: "2026-11-01T00:00:00Z" }, error: null };
  expect((await POST(post({ startMs: 0, endMs: 10_000 }), { params })).status).toBe(410);
});

it("refuses a window past the end of the recording", async () => {
  expect((await POST(post({ startMs: 120_000, endMs: 130_000 }), { params })).status).toBe(422);
});

it("answers 503 before the table exists", async () => {
  tables["recording_shares:insert"] = { data: null, error: { code: "42P01" } };
  expect((await POST(post({ startMs: 0, endMs: 10_000 }), { params })).status).toBe(503);
});

it("lists the caller's links without their tokens", async () => {
  const res = await GET(new NextRequest("http://localhost/x"), { params });
  const body = (await res.json()) as { shares: Array<Record<string, unknown>> };
  expect(body.shares).toHaveLength(1);
  expect(body.shares[0]).toMatchObject({ id: "s1", openCount: 0 });
  expect(Object.keys(body.shares[0])).not.toContain("token_hash");
});

it("lists nothing, not an error, before the table exists", async () => {
  tables.recording_shares = { data: null, error: { code: "42P01" } };
  expect(await (await GET(new NextRequest("http://localhost/x"), { params })).json()).toEqual({ shares: [] });
});
