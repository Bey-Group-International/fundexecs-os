/**
 * A meeting's report history, and going back to an earlier version.
 *
 * Restoring APPENDS a copy rather than deleting what came after, so the version
 * being replaced stays in the history; and only the host may do it.
 */
const requireOrgContext = jest.fn();
const from = jest.fn();

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => requireOrgContext() }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ from: (t: string) => from(t) }),
}));

import { GET, POST } from "./route";

const params = { params: Promise.resolve({ id: "m1" }) };
const MEETING = { id: "m1", host_id: "host-1" };
const ROWS = [
  { id: "r2", created_at: "2026-10-01T11:00:00Z", summary: "New", analysis: { correction_note: "Fix it" }, full_transcript: "A: newest" },
  { id: "r1", created_at: "2026-10-01T10:00:00Z", summary: "Old", key_points: ["k"], action_items: ["a"], analysis: { follow_up_draft: "Hi {{first_name}}," }, full_transcript: "A: old" },
];

let inserted: Record<string, unknown> | undefined;
let meetingUpdate: Record<string, unknown> | undefined;

function wire({ meeting = MEETING as unknown } = {}) {
  from.mockImplementation((table: string) => {
    let byId: string | null = null;
    const b: Record<string, unknown> = {
      select: () => b,
      is: () => b,
      order: () => b,
      eq: (col: string, val: string) => {
        if (col === "id" && table === "live_meeting_reports") byId = val;
        return b;
      },
      limit: () => Object.assign(Promise.resolve({ data: ROWS, error: null }), b),
      maybeSingle: async () => {
        if (table === "live_meetings") return { data: meeting, error: null };
        if (byId) return { data: ROWS.find((r) => r.id === byId) ?? null, error: null };
        return { data: ROWS[0], error: null };
      },
      insert: async (row: Record<string, unknown>) => {
        inserted = row;
        return { error: null };
      },
      update: (row: Record<string, unknown>) => {
        meetingUpdate = row;
        return { eq: async () => ({ error: null }) };
      },
    };
    return b;
  });
}

const post = (body: unknown) =>
  new Request("http://localhost/api/meetings/m1/report/versions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  inserted = undefined;
  meetingUpdate = undefined;
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "host-1" } });
});

describe("GET", () => {
  it("lists versions newest first, with the correction each came from", async () => {
    wire();
    const res = await GET(new Request("http://localhost"), params);
    const json = await res.json();
    expect(json.canRestore).toBe(true);
    expect(json.versions.map((v: { id: string }) => v.id)).toEqual(["r2", "r1"]);
    expect(json.versions[0]).toMatchObject({ current: true, correction: "Fix it" });
  });

  it("does not offer restoring to anyone but the host", async () => {
    requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "attendee" } });
    wire();
    const json = await (await GET(new Request("http://localhost"), params)).json();
    expect(json.canRestore).toBe(false);
  });

  it("404s a meeting that does not exist", async () => {
    wire({ meeting: null });
    expect((await GET(new Request("http://localhost"), params)).status).toBe(404);
  });
});

describe("POST (restore)", () => {
  it("appends a copy of the old version, keeping the newest transcript", async () => {
    wire();
    const res = await POST(post({ versionId: "r1" }), params);
    expect(res.status).toBe(200);
    expect(inserted).toMatchObject({
      meeting_id: "m1",
      summary: "Old",
      key_points: ["k"],
      action_items: ["a"],
      full_transcript: "A: newest",
    });
    expect(inserted?.analysis).toMatchObject({ restored_from: "r1", follow_up_draft: "Hi {{first_name}}," });
    expect(meetingUpdate).toEqual({ followup_status: "draft" });
  });

  it("refuses anyone who is not the host", async () => {
    requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "attendee" } });
    wire();
    expect((await POST(post({ versionId: "r1" }), params)).status).toBe(403);
    expect(inserted).toBeUndefined();
  });

  it("refuses to restore the version that is already current", async () => {
    wire();
    expect((await POST(post({ versionId: "r2" }), params)).status).toBe(409);
    expect(inserted).toBeUndefined();
  });

  it("404s a version that is not this meeting's", async () => {
    wire();
    expect((await POST(post({ versionId: "nope" }), params)).status).toBe(404);
  });

  it("400s without a version id", async () => {
    wire();
    expect((await POST(post({}), params)).status).toBe(400);
  });
});
