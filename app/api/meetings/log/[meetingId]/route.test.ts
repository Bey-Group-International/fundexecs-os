// The prose behind one log row.
//
// The list ships a line per meeting; this is the request a row makes when it
// opens. So the tests are about the two things that decide whether that is safe
// to do at all: it answers with one meeting's detail and its OWN id, and it
// refuses a meeting the caller was not in rather than quietly returning the
// empty report RLS would hand back.

let auth: { ok: boolean; ctx?: { orgId: string; userId: string }; status?: number; error?: string } = {
  ok: true,
  ctx: { orgId: "org-1", userId: "user-1" },
};

jest.mock("@/lib/auth", () => ({
  requireOrgContext: async () => auth,
}));

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({}),
}));

let asked: { orgId: string; userId: string; meetingId: string } | null = null;
let loaded: Record<string, unknown> | null = null;

jest.mock("@/lib/meetings/meeting-log.server", () => ({
  loadLogDetail: async (_supabase: unknown, orgId: string, userId: string, meetingId: string) => {
    asked = { orgId, userId, meetingId };
    return loaded;
  },
}));

import { GET } from "./route";

const MEETING = "11111111-1111-1111-1111-111111111111";

function row(over: { attended?: boolean } = {}) {
  return {
    meeting: {
      id: MEETING,
      room_code: "abc-123",
      title: "Dunbar Capital — Series B",
      created_at: "2026-09-01T09:00:00.000Z",
      started_at: "2026-09-07T14:00:00.000Z",
      ended_at: "2026-09-07T14:47:00.000Z",
      scheduled_at: null,
      duration_minutes: 45,
      status: "ended",
      attendees: [{ name: "Ana Ruiz" }, { name: "Priya Shah" }],
      is_draft: false,
    },
    report: {
      summary: "They agreed to wire the second tranche on Friday.",
      key_points: ["Second tranche wiring"],
      action_items: ["Ana to circulate the valuation memo"],
      analysis: { decisions: ["Wire Friday subject to the memo"], sentiment: "positive" },
      has_transcript: true,
    },
    attended: over.attended ?? true,
    isHost: true,
  };
}

const params = (id: string = MEETING) => Promise.resolve({ meetingId: id });
const req = new Request(`https://fundexecs.test/api/meetings/log/${MEETING}`);

beforeEach(() => {
  auth = { ok: true, ctx: { orgId: "org-1", userId: "user-1" } };
  asked = null;
  loaded = null;
});

describe("GET /api/meetings/log/[meetingId]", () => {
  it("answers with the prose the row left behind", async () => {
    loaded = row();
    const body = (await (await GET(req, { params: params() })).json()) as {
      detail: {
        id: string;
        summary: string;
        keyPoints: string[];
        decisions: string[];
        actionItems: string[];
        attendeeNames: string[];
      };
    };
    expect(body.detail.summary).toBe("They agreed to wire the second tranche on Friday.");
    expect(body.detail.keyPoints).toEqual(["Second tranche wiring"]);
    expect(body.detail.decisions).toEqual(["Wire Friday subject to the memo"]);
    expect(body.detail.actionItems).toEqual(["Ana to circulate the valuation memo"]);
    expect(body.detail.attendeeNames).toEqual(["Ana Ruiz", "Priya Shah"]);
  });

  it("says which meeting it is about", async () => {
    // The reader can open a second row while this request is in flight. The id
    // travels so the answer is filed under the meeting it describes rather than
    // the one that was last clicked.
    loaded = row();
    const body = (await (await GET(req, { params: params() })).json()) as { detail: { id: string } };
    expect(body.detail.id).toBe(MEETING);
  });

  it("refuses a meeting the caller was not in", async () => {
    // RLS would hand back an empty report here, which reads as "no report" —
    // a record being denied rather than withheld. Said plainly instead.
    loaded = row({ attended: false });
    const res = await GET(req, { params: params() });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; detail?: unknown };
    expect(body.detail).toBeUndefined();
    expect(body.error).toMatch(/weren/);
  });

  it("does not leak the prose in the refusal", async () => {
    // A 403 that carried the summary would be the disclosure the status code
    // says did not happen.
    loaded = row({ attended: false });
    const text = await (await GET(req, { params: params() })).text();
    expect(text).not.toContain("wire the second tranche");
    expect(text).not.toContain("Second tranche wiring");
  });

  it("is a 404 for a meeting that is not there", async () => {
    loaded = null;
    const res = await GET(req, { params: params("nope") });
    expect(res.status).toBe(404);
  });

  it("asks for the meeting in the caller's own organisation", async () => {
    loaded = row();
    await GET(req, { params: params() });
    expect(asked).toEqual({ orgId: "org-1", userId: "user-1", meetingId: MEETING });
  });

  it("reads nothing for somebody who is not signed in", async () => {
    auth = { ok: false, status: 401, error: "Not authenticated" };
    const res = await GET(req, { params: params() });
    expect(res.status).toBe(401);
    expect(asked).toBeNull();
  });

  it("is never cached: a regenerated report must not be answered from an old one", async () => {
    loaded = row();
    const res = await GET(req, { params: params() });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
