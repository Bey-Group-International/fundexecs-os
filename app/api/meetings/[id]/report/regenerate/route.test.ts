/**
 * Regenerating a meeting report from the transcript already on file.
 *
 * Two properties matter more than the happy path. It is HOST ONLY, because the
 * report is a record every attendee reads. And it APPENDS a new report row
 * rather than updating the existing one — the log embeds reports ordered
 * `created_at desc limit 1`, so an insert becomes the visible report while the
 * previous one stays readable in the table. That is what makes this safe to run
 * without an "are you sure": nothing is destroyed.
 */
const requireOrgContext = jest.fn();
const gateConversationalSpend = jest.fn();
const generateMeetingReport = jest.fn();
const from = jest.fn();

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => requireOrgContext() }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ from: (t: string) => from(t) }),
}));
jest.mock("@/lib/anthropic-client", () => ({ anthropicClient: () => ({}), LONG_RUN_TIMEOUT_MS: 1 }));
jest.mock("@/lib/conversational-gate", () => ({
  CONVERSATIONAL_COST: { meetingAnalyze: 5 },
  gateConversationalSpend: (...a: unknown[]) => gateConversationalSpend(...a),
}));
jest.mock("@/lib/meetings/report-analysis", () => ({
  generateMeetingReport: (...a: unknown[]) => generateMeetingReport(...a),
}));

import { POST } from "./route";

const params = { params: Promise.resolve({ id: "m1" }) };
const req = () => new Request("http://localhost/api/meetings/m1/report/regenerate", { method: "POST" });

const MEETING = {
  id: "m1", room_code: "abc-def-gh", title: "LP Update", host_id: "host-1",
  organization_id: "org1", attendees: [{ name: "Ana", email: "ana@f.test" }],
  created_at: "2026-03-01T10:00:00Z", started_at: null, ended_at: "2026-03-01T11:00:00Z",
  scheduled_at: "2026-03-01T10:00:00Z", duration_minutes: 60, status: "ended", is_draft: false,
};

/** Records what the route did to live_meeting_reports. */
const writes: { inserted?: Record<string, unknown>; updated?: unknown } = {};

function wire({
  meeting = MEETING as unknown,
  report = { id: "r1", full_transcript: "Ana: we agreed to wire on Friday." } as unknown,
  insertResult = { data: { summary: "s", key_points: [], action_items: [], analysis: {} }, error: null },
}: { meeting?: unknown; report?: unknown; insertResult?: unknown } = {}) {
  from.mockImplementation((table: string) => {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, is: () => b, order: () => b, limit: () => b,
      maybeSingle: async () => ({ data: table === "live_meetings" ? meeting : report, error: null }),
      insert: (row: Record<string, unknown>) => { writes.inserted = row; return b; },
      update: (row: unknown) => { writes.updated = row; return b; },
      single: async () => insertResult,
    };
    return b;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  writes.inserted = undefined;
  writes.updated = undefined;
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "host-1" } });
  gateConversationalSpend.mockResolvedValue({ ok: true });
  generateMeetingReport.mockResolvedValue({
    summary: "They agreed to wire on Friday.",
    key_points: ["Timing"], action_items: ["Ana: wire Friday"], decisions: ["Wire on Friday"],
    sentiment: "positive", next_meeting_suggestion: "", follow_up_draft: "Hi…",
  });
});

describe("permission", () => {
  it("refuses anyone who is not the host", async () => {
    requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "someone-else" } });
    wire();
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
    expect(writes.inserted).toBeUndefined();
    expect(generateMeetingReport).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller", async () => {
    requireOrgContext.mockResolvedValue({ ok: false, status: 401, error: "Not authenticated" });
    const res = await POST(req(), params);
    expect(res.status).toBe(401);
  });

  it("404s a meeting that does not exist", async () => {
    wire({ meeting: null });
    expect((await POST(req(), params)).status).toBe(404);
  });
});

describe("the transcript it works from", () => {
  it("uses the stored transcript — the caller never supplies one", async () => {
    wire();
    await POST(req(), params);
    // Third argument is the input; the first is the Anthropic client, which is
    // null here because the test env has no API key — the same path production
    // takes when the key is absent, and covered by the "empty report" case.
    expect(generateMeetingReport.mock.calls[0][2]).toMatchObject({
      transcript: "Ana: we agreed to wire on Friday.",
      title: "LP Update",
    });
  });

  it("passes the meeting's own attendees as participants", async () => {
    wire();
    await POST(req(), params);
    expect(generateMeetingReport.mock.calls[0][2]).toMatchObject({ participants: ["Ana"] });
  });

  it("409s when there is no transcript on file, rather than failing silently", async () => {
    wire({ report: { id: "r1", full_transcript: "   " } });
    const res = await POST(req(), params);
    expect(res.status).toBe(409);
    expect(generateMeetingReport).not.toHaveBeenCalled();
  });
});

describe("what it writes", () => {
  it("inserts a new report and never updates the old one", async () => {
    wire();
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(writes.inserted).toMatchObject({ meeting_id: "m1", summary: "They agreed to wire on Friday." });
    expect(writes.updated).toBeUndefined();
  });

  it("carries the same transcript onto the new row", async () => {
    // The transcript is the record of what was said; a regeneration
    // reinterprets it and must not drop it from the new report.
    wire();
    await POST(req(), params);
    expect(writes.inserted).toMatchObject({ full_transcript: "Ana: we agreed to wire on Friday." });
  });

  it("keeps decisions on the analysis blob, which the log reads", async () => {
    wire();
    await POST(req(), params);
    expect((writes.inserted!.analysis as Record<string, unknown>).decisions).toEqual(["Wire on Friday"]);
  });

  it("returns the entry in the shape the log renders", async () => {
    wire({
      insertResult: {
        data: {
          summary: "They agreed to wire on Friday.",
          key_points: ["Timing"],
          action_items: ["Ana: wire Friday"],
          analysis: { decisions: ["Wire on Friday"], sentiment: "positive" },
        },
        error: null,
      },
    });
    const json = (await (await POST(req(), params)).json()) as { entry: Record<string, unknown> };
    expect(json.entry).toMatchObject({
      id: "m1", roomCode: "abc-def-gh", title: "LP Update",
      decisions: ["Wire on Friday"], hasReport: true, attended: true,
    });
  });
});

describe("when the model gives nothing back", () => {
  it("refuses to append an empty report over a real one", async () => {
    generateMeetingReport.mockResolvedValue({ summary: "", key_points: [], action_items: [] });
    wire();
    const res = await POST(req(), params);
    expect(res.status).toBe(502);
    // Nothing written, so the existing report stays the newest and the host
    // does not watch their report get replaced by blanks.
    expect(writes.inserted).toBeUndefined();
  });

  it("reports a model failure rather than writing a broken row", async () => {
    generateMeetingReport.mockRejectedValue(new Error("upstream 529"));
    wire();
    expect((await POST(req(), params)).status).toBe(502);
    expect(writes.inserted).toBeUndefined();
  });
});

describe("credits", () => {
  it("stops before calling the model when the org cannot pay", async () => {
    gateConversationalSpend.mockResolvedValue({ ok: false, status: 402, error: "Not enough credits" });
    wire();
    const res = await POST(req(), params);
    expect(res.status).toBe(402);
    expect(generateMeetingReport).not.toHaveBeenCalled();
    expect(writes.inserted).toBeUndefined();
  });
});
