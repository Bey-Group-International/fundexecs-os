/** Changing a clip link: revoke (once), the download switch, and retrying a failed cut. Creator only. */
const authMock = jest.fn();
const afterCalls: Array<() => unknown> = [];
const purgeClip = jest.fn(async () => 0);
const buildClip = jest.fn(async () => ({ ok: true }));
const serviceUpdates: unknown[] = [];
let single: { data: unknown; error: unknown } = { data: null, error: null };
jest.mock("next/server", () => ({
  ...jest.requireActual("next/server"),
  after: (fn: () => unknown) => afterCalls.push(fn),
}));
jest.mock("@/lib/meetings/recording-clip.server", () => ({
  purgeClip: (...a: unknown[]) => purgeClip(...(a as [])),
  buildClip: (...a: unknown[]) => buildClip(...(a as [])),
}));
const calls: Array<{ method: string; args: unknown[] }> = [];
let result: { data: unknown; error: unknown } = { data: [], error: null };

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      q.update = (row: unknown) => {
        serviceUpdates.push(row);
        return q;
      };
      q.eq = () => q;
      q.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
      return q;
    },
  }),
  createServerClient: async () => {
    const q: Record<string, unknown> = {};
    q.maybeSingle = async () => single;
    for (const m of ["update", "eq", "is", "select"]) {
      q[m] = (...args: unknown[]) => {
        calls.push({ method: m, args });
        return q;
      };
    }
    q.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return { from: () => q };
  },
}));

import { NextRequest } from "next/server";
import { PATCH } from "./route";

const params = Promise.resolve({ shareId: "s1" });
const patch = (body: unknown) =>
  new NextRequest("http://localhost/api/recording-shares/s1", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  calls.length = 0;
  afterCalls.length = 0;
  serviceUpdates.length = 0;
  purgeClip.mockClear();
  buildClip.mockClear();
  authMock.mockReturnValue({ ok: true, ctx: { userId: "u1", orgId: "o1" } });
  result = {
    data: [{ id: "s1", label: null, start_ms: 0, end_ms: 10_000, expires_at: "2026-11-13T00:00:00Z", revoked_at: "2026-11-06T00:00:00Z", open_count: 3, last_opened_at: null, created_at: "2026-11-01T00:00:00Z" }],
    error: null,
  };
});

it("revokes the caller's own live link", async () => {
  const res = await PATCH(patch({ revoke: true }), { params });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { share: { revokedAt: string } }).share.revokedAt).toBeTruthy();
  expect(calls).toContainEqual({ method: "eq", args: ["created_by", "u1"] });
  expect(calls).toContainEqual({ method: "is", args: ["revoked_at", null] });
  // The clip's media is deleted straight after, not at the next sweep.
  expect(afterCalls).toHaveLength(1);
  await afterCalls[0]();
  expect(purgeClip).toHaveBeenCalledWith(expect.anything(), "s1");
});

it("switches downloads on and off, writing only that column", async () => {
  const res = await PATCH(patch({ allowDownload: true }), { params });
  expect(res.status).toBe(200);
  expect(calls).toContainEqual({ method: "update", args: [{ allow_download: true }] });
  expect(calls).toContainEqual({ method: "eq", args: ["created_by", "u1"] });
});

it("retries a failed cut through the server, after checking the caller owns it", async () => {
  single = {
    data: { id: "s1", label: null, start_ms: 0, end_ms: 10_000, expires_at: "2099-01-01T00:00:00Z", revoked_at: null, open_count: 0, last_opened_at: null, created_at: "2026-11-01T00:00:00Z", clip_status: "failed" },
    error: null,
  };
  const res = await PATCH(patch({ retry: true }), { params });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { share: { clipStatus: string } }).share.clipStatus).toBe("pending");
  expect(serviceUpdates[0]).toMatchObject({ clip_status: "pending", clip_attempts: 0 });
  await afterCalls[0]();
  expect(buildClip).toHaveBeenCalledWith(expect.anything(), "s1");
});

it("does not retry a clip that has not failed, or one that is not the caller's", async () => {
  single = { data: { id: "s1", expires_at: "2099-01-01T00:00:00Z", revoked_at: null, clip_status: "ready" }, error: null };
  expect((await PATCH(patch({ retry: true }), { params })).status).toBe(409);
  single = { data: null, error: null };
  expect((await PATCH(patch({ retry: true }), { params })).status).toBe(404);
  expect(serviceUpdates).toEqual([]);
});

it("answers 404 when nothing of the caller's matched", async () => {
  result = { data: [], error: null };
  expect((await PATCH(patch({ revoke: true }), { params })).status).toBe(404);
});

it("refuses a body that asks for nothing", async () => {
  expect((await PATCH(patch({}), { params })).status).toBe(400);
  expect(calls).toEqual([]);
});
