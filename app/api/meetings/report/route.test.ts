/**
 * Ending a meeting: writing its report.
 *
 * The property under test is what happens when the MODEL fails. Everything
 * this route does splits in two — the analysis, which is the model's, and the
 * bookkeeping, which is the meeting's: the transcript is kept on a report row,
 * and the meeting is marked ended (this route is the only place that ever
 * does). A model failure must not skip the bookkeeping, and must not be
 * reported to the room as success, because MeetingRoom navigates away on
 * `res.ok` and only shows its "try again" on a failure.
 */
const getUser = jest.fn();
const from = jest.fn();
const generateMeetingReport = jest.fn();
const persistInstitutionalMeetingRecord = jest.fn();
const createTeamTask = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ auth: { getUser: () => getUser() }, from: (t: string) => from(t) }),
}));
jest.mock("@/lib/anthropic-client", () => ({ anthropicClient: () => ({}), LONG_RUN_TIMEOUT_MS: 1 }));
jest.mock("@/lib/team-tasks", () => ({ createTeamTask: (...a: unknown[]) => createTeamTask(...a) }));
jest.mock("@/lib/meetings/service", () => ({
  persistInstitutionalMeetingRecord: (...a: unknown[]) => persistInstitutionalMeetingRecord(...a),
}));
jest.mock("@/lib/meetings/report-analysis", () => ({
  EMPTY_REPORT: { summary: "", key_points: [], action_items: [] },
  clampTranscript: (t: string) => t,
  generateMeetingReport: (...a: unknown[]) => generateMeetingReport(...a),
}));

import { POST } from "./route";

const MEETING = {
  id: "m1", host_id: "host-1", organization_id: "org1", deal_id: null, title: "LP Update",
};

const TRANSCRIPT = "Ana: we agreed to wire on Friday.";

const req = () =>
  new Request("http://localhost/api/meetings/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ meetingId: "m1", transcript: TRANSCRIPT, duration: 3600 }),
  });

/** What the route did to each table. */
const writes: { reports: Record<string, unknown>[]; meetingUpdate?: Record<string, unknown> } = {
  reports: [],
};

function wire({ meeting = MEETING as unknown } = {}) {
  from.mockImplementation((table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      insert: (row: Record<string, unknown>) => {
        if (table === "live_meeting_reports") writes.reports.push(row);
        return b;
      },
      update: (row: Record<string, unknown>) => {
        if (table === "live_meetings") writes.meetingUpdate = row;
        return b;
      },
      single: async () => ({ data: table === "live_meetings" ? meeting : { id: "r1" }, error: null }),
    };
    // `update(...).eq(...)` is awaited directly, with no .single().
    b.then = undefined;
    return b;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  writes.reports = [];
  writes.meetingUpdate = undefined;
  getUser.mockResolvedValue({ data: { user: { id: "host-1" } } });
  generateMeetingReport.mockResolvedValue({
    summary: "They agreed to wire on Friday.",
    key_points: ["Timing"],
    action_items: [],
    decisions: ["Wire on Friday"],
  });
});

describe("permission", () => {
  it("refuses a signed-out caller", async () => {
    wire();
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(req())).status).toBe(401);
    expect(writes.reports).toHaveLength(0);
  });

  it("refuses anyone who is not the host", async () => {
    wire({ meeting: { ...MEETING, host_id: "someone-else" } });
    expect((await POST(req())).status).toBe(403);
    expect(writes.reports).toHaveLength(0);
  });
});

describe("when the model succeeds", () => {
  it("writes the report, ends the meeting and answers ok", async () => {
    wire();
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(writes.reports[0]).toMatchObject({
      meeting_id: "m1",
      summary: "They agreed to wire on Friday.",
      full_transcript: TRANSCRIPT,
    });
    expect(writes.meetingUpdate).toMatchObject({ status: "ended" });
  });
});

describe("when the model fails", () => {
  // The route logs the failure on purpose; that is not test output.
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    generateMeetingReport.mockRejectedValue(new Error("529 overloaded"));
  });
  afterEach(() => errorSpy.mockRestore());

  it("tells the room, so its retry appears instead of a blank report", async () => {
    wire();
    // The bug this replaced: the failure was swallowed and answered 200, so
    // MeetingRoom navigated to a report page with nothing on it, and the log's
    // regenerate action was hidden too (`hasReport` is `summary.length > 0`).
    expect((await POST(req())).status).toBe(500);
  });

  it("still keeps the transcript on a report row", async () => {
    wire();
    await POST(req());
    expect(writes.reports).toHaveLength(1);
    expect(writes.reports[0]).toMatchObject({ meeting_id: "m1", summary: "", full_transcript: TRANSCRIPT });
  });

  it("still marks the meeting ended", async () => {
    wire();
    await POST(req());
    // This route is the only place a meeting is ever marked ended, and
    // /api/meetings/upcoming lists everything that is not — so a meeting left
    // unmarked here sits in "Upcoming" forever.
    expect(writes.meetingUpdate).toMatchObject({ status: "ended" });
  });

  it("creates no institutional record and no tasks", async () => {
    wire();
    await POST(req());
    // Nothing to record, no action items to raise, and the retry re-runs both.
    expect(persistInstitutionalMeetingRecord).not.toHaveBeenCalled();
    expect(createTeamTask).not.toHaveBeenCalled();
  });
});

describe("when no API key is configured", () => {
  it("is not a failure — the empty report is written and the meeting ends", async () => {
    // generateMeetingReport returns EMPTY_REPORT rather than throwing, so this
    // takes the success path deliberately.
    generateMeetingReport.mockResolvedValue({ summary: "", key_points: [], action_items: [] });
    wire();
    expect((await POST(req())).status).toBe(200);
    expect(writes.meetingUpdate).toMatchObject({ status: "ended" });
  });
});
