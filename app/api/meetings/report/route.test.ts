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
const clampTranscript = jest.fn((t: string) => t);

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
  clampTranscript: (t: string) => clampTranscript(t),
  generateMeetingReport: (...a: unknown[]) => generateMeetingReport(...a),
}));

import { POST, maxDuration } from "./route";
import { NOISE_NOTE } from "@/lib/meetings/transcript-quality";
import { REPORT_WAIT_LIMIT_MS } from "@/lib/meetings/attendance";
import { REPORT_FRESH_MS, UNSUMMARISED_KEY } from "@/lib/meetings/report-generation";

const MEETING = {
  id: "m1", host_id: "host-1", organization_id: "org1", deal_id: null, title: "LP Update",
};

const TRANSCRIPT = "Ana: we agreed to wire on Friday.";

const req = (transcript: string = TRANSCRIPT) =>
  new Request("http://localhost/api/meetings/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ meetingId: "m1", transcript, duration: 3600 }),
  });

/** What the route did to each table. */
const writes: { reports: Record<string, unknown>[]; meetingUpdate?: Record<string, unknown> } = {
  reports: [],
};

function wire({
  meeting = MEETING as unknown,
  participants = [] as Array<{ joined_at: string; display_name?: string; guest_key?: string }>,
  reports = [] as Array<{ id: string; created_at: string; analysis?: unknown }>,
} = {}) {
  from.mockImplementation((table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      order: () => b,
      // loadOrgDirectory pages with .range(); it fails closed, so a harness
      // that answers nothing means "everything stays with the host".
      range: async () => ({ data: [], error: null }),
      in: async () => ({ data: [], error: null }),
      // The "what has this meeting already raised?" read, the attendance rows
      // (the earliest is where started_at comes from), and the newest report
      // row the repeat check reads.
      limit: async () => ({
        data:
          table === "live_meeting_participants" ? participants
          : table === "live_meeting_reports" ? reports
          : [],
        error: null,
      }),
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

describe("what the model is allowed to read", () => {
  // The Gary Jinks meeting: 64 minutes whose transcript is a noisy room and a
  // smart speaker recognised as fluent English. Every one of those lines used to
  // reach the summariser, which is why the only honest report it could produce
  // was an apology — and why on another day it might instead have summarised
  // decisions nobody made.
  const BAD = [
    "Gary: so where did we land on the close",
    `Gary (${NOISE_NOTE}): Shah Rukh Khan`,
    `Astin (${NOISE_NOTE}): Rusher Rashad`,
    "Astin: Alexa, search the shopping list",
    "Astin: the week after next works",
  ].join("\n");

  it("withholds recognised noise and voice-assistant orders", async () => {
    wire();
    await POST(req(BAD));
    const sent = generateMeetingReport.mock.calls[0][2] as { transcript: string };
    expect(sent.transcript).toContain("so where did we land on the close");
    expect(sent.transcript).toContain("the week after next works");
    expect(sent.transcript).not.toContain("Shah Rukh Khan");
    expect(sent.transcript).not.toContain("Rusher Rashad");
    expect(sent.transcript).not.toContain("shopping list");
  });

  it("says how much was withheld and why", async () => {
    wire();
    await POST(req(BAD));
    const sent = generateMeetingReport.mock.calls[0][2] as { transcript: string };
    expect(sent.transcript).toContain("[audio quality]");
    expect(sent.transcript).toContain("hearing noise rather than words");
    expect(sent.transcript).toContain("commands to a voice assistant");
  });

  it("stores the whole record, unfiltered and with no note of its own", async () => {
    // The transcript is the record of what the room heard and is not ours to
    // edit; only the model's copy is filtered. Storing the note would also
    // re-prepend it on every later regenerate.
    wire();
    await POST(req(BAD));
    expect(writes.reports[0]).toMatchObject({ full_transcript: BAD });
  });

  it("never trims the stored record to the model's budget", async () => {
    // The model-context clamp used to run BEFORE the store, so a meeting longer
    // than the budget had the opening of its permanent record cut off —
    // full_transcript, the institutional record and every later regenerate all
    // read from that one write. The route must not clamp at all: the model's
    // copy is clamped inside generateMeetingReport, on its own input.
    wire();
    await POST(req(BAD));
    expect(clampTranscript).not.toHaveBeenCalled();
    expect(writes.reports[0]).toMatchObject({ full_transcript: BAD });
  });

  // `BAD` is 2 usable of 5, which is "degraded" — bad audio, still summarisable.
  // The log line only fires on "unusable", so the two tests about it need a
  // transcript where recognised noise genuinely outnumbers what survived.
  const UNUSABLE = [
    "Gary: so where did we land on the close",
    ...Array.from({ length: 6 }, (_, i) => `Gary (${NOISE_NOTE}): garble ${i}`),
  ].join("\n");

  it("cannot have a forged line written into the operator's log", async () => {
    // CodeQL found this: the warning interpolated `body.meetingId` straight from
    // the request. A sender who puts a newline in it writes a second entry of
    // their own choosing into the log an operator reads to find out what
    // happened. The id now comes from the row, and whatever it holds is stripped
    // of anything unprintable.
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      wire({ meeting: { ...MEETING, id: "m1\n[/api/meetings/report] meeting m9 transcript is usable" } });
      await POST(req(UNUSABLE));
      const lines = warn.mock.calls.map((c) => String(c[0]));
      const ours = lines.filter((l) => l.includes("transcript is"));
      // One entry, not two, and nothing of the sender's text inside it: an
      // operator sees that the id was not loggable rather than a fabrication
      // dressed up as ours.
      expect(ours).toHaveLength(1);
      expect(ours[0]).not.toContain("\n");
      expect(ours[0]).not.toContain("meeting m9");
      expect(ours[0]).toContain("(id not loggable)");
    } finally {
      warn.mockRestore();
    }
  });

  it("names the meeting when the id is an ordinary one", async () => {
    // The whole point of the line: an operator has to know which call it was.
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      wire({ meeting: { ...MEETING, id: "0f9b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d" } });
      await POST(req(UNUSABLE));
      const ours = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("transcript is"));
      expect(ours[0]).toContain("meeting 0f9b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d");
    } finally {
      warn.mockRestore();
    }
  });

  it("leaves a clean transcript exactly as it is", async () => {
    wire();
    await POST(req());
    expect(generateMeetingReport.mock.calls[0][2]).toMatchObject({ transcript: TRANSCRIPT });
  });

  describe("a transcript that is noise and nothing else", () => {
    let warn: jest.SpyInstance;
    beforeEach(() => { warn = jest.spyOn(console, "warn").mockImplementation(() => {}); });
    afterEach(() => warn.mockRestore());

    // Handed an hour of recognised noise, the model either apologised or
    // confidently summarised decisions nobody made. It is no longer asked.
    it("never reaches the model", async () => {
      wire();
      const res = await POST(req(UNUSABLE));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, summarised: false, reason: "unusable" });
      expect(generateMeetingReport).not.toHaveBeenCalled();
    });

    it("files a finished report that says so, with the whole record behind it", async () => {
      wire();
      await POST(req(UNUSABLE));
      expect(writes.reports).toHaveLength(1);
      expect(writes.reports[0]).toMatchObject({ summary: "", full_transcript: UNUSABLE });
      expect((writes.reports[0].analysis as Record<string, unknown>)[UNSUMMARISED_KEY]).toBe("unusable");
    });

    it("still closes the meeting", async () => {
      wire({ participants: [{ joined_at: "2026-10-05T14:59:50.497Z" }] });
      await POST(req(UNUSABLE));
      expect(writes.meetingUpdate).toMatchObject({ status: "ended", started_at: "2026-10-05T14:59:50.497Z" });
      expect(persistInstitutionalMeetingRecord).not.toHaveBeenCalled();
    });
  });
});

describe("the function envelope", () => {
  it("is declared, and the page's wait is at least as long as it", () => {
    // The page gives up waiting at REPORT_WAIT_LIMIT_MS, derived from a 300s
    // envelope. A route that could outlive the page's patience would have the
    // page declare a report dead while the route was still writing it.
    expect(maxDuration).toBe(300);
    expect(maxDuration * 1000).toBeLessThanOrEqual(REPORT_WAIT_LIMIT_MS);
  });
});

describe("the same press of End, arriving twice", () => {
  const fresh = new Date(Date.now() - REPORT_FRESH_MS / 2).toISOString();
  const stale = new Date(Date.now() - REPORT_FRESH_MS * 2).toISOString();

  // A browser that gave up waiting, a reload, or the retry state pressed on a
  // response that was on its way posts the same transcript again. The second
  // run cost a second model call, a second report row, and every action item
  // raised twice.
  it("answers with the report just written rather than writing another", async () => {
    wire({
      meeting: { ...MEETING, status: "ended" },
      reports: [{ id: "r-fresh", created_at: fresh, analysis: { summary: "Already done." } }],
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reportId: "r-fresh", repeated: true });
    expect(generateMeetingReport).not.toHaveBeenCalled();
    expect(writes.reports).toHaveLength(0);
    expect(writes.meetingUpdate).toBeUndefined();
  });

  it("still writes a new version once the window has passed", async () => {
    wire({
      meeting: { ...MEETING, status: "ended" },
      reports: [{ id: "r-old", created_at: stale, analysis: { summary: "Old." } }],
    });
    expect((await POST(req())).status).toBe(200);
    expect(generateMeetingReport).toHaveBeenCalledTimes(1);
    expect(writes.reports).toHaveLength(1);
  });

  it("is not a repeat when the meeting was never ended", async () => {
    wire({ reports: [{ id: "r-fresh", created_at: fresh }] });
    await POST(req());
    expect(generateMeetingReport).toHaveBeenCalledTimes(1);
  });
});

describe("who the report names", () => {
  it("names the room's attendance and the transcript's speakers, never the invite list", async () => {
    wire({
      meeting: { ...MEETING, attendees: [{ name: "Never Joined", email: "nj@x.test" }] },
      participants: [{ joined_at: "2026-10-05T14:59:50.497Z", display_name: "Dana", guest_key: "g1" }],
    });
    await POST(new Request("http://localhost/api/meetings/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingId: "m1", transcript: "Ana: we agreed.\nBo: yes.", participants: ["Rae"] }),
    }));
    const sent = generateMeetingReport.mock.calls[0][2] as { participants: string[] };
    expect(sent.participants).toEqual(expect.arrayContaining(["Dana", "Ana", "Bo", "Rae"]));
    expect(sent.participants).not.toContain("Never Joined");
    // The institutional record names the same people.
    expect(persistInstitutionalMeetingRecord.mock.calls[0][1]).toMatchObject({ participants: sent.participants });
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

describe("when the meeting ran", () => {
  // The room never wrote started_at (its write was never sent), so the route
  // fills it in from the first attendance row when it closes the meeting.
  it("records when the room opened, from the first attendance row", async () => {
    wire({ participants: [{ joined_at: "2026-10-05T14:59:50.497Z" }] });
    await POST(req());
    expect(writes.meetingUpdate).toMatchObject({ status: "ended", started_at: "2026-10-05T14:59:50.497Z" });
  });

  it("counts back from the end by the browser's clock when nobody's join was recorded", async () => {
    wire();
    await POST(req());
    const update = writes.meetingUpdate as { ended_at: string; started_at: string };
    expect(Date.parse(update.ended_at) - Date.parse(update.started_at)).toBe(3600_000);
  });

  it("never overwrites a start the room did record", async () => {
    wire({
      meeting: { ...MEETING, started_at: "2026-10-05T14:30:00.000Z" },
      participants: [{ joined_at: "2026-10-05T14:59:50.497Z" }],
    });
    await POST(req());
    expect(writes.meetingUpdate).not.toHaveProperty("started_at");
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

describe("action items become tasks", () => {
  // createTeamTask answers the row it wrote, or null when it could not.
  beforeEach(() => createTeamTask.mockResolvedValue({ id: "t1" }));

  const withItems = (items: string[]) =>
    generateMeetingReport.mockResolvedValue({
      summary: "They agreed to wire on Friday.",
      key_points: ["Timing"],
      action_items: items,
      decisions: [],
    });

  /** The input each createTeamTask call was made with. */
  const taskInputs = () => createTeamTask.mock.calls.map((c) => c[1] as Record<string, unknown>);

  // The bug: this was `void Promise.allSettled(...)` on the line before the
  // response. On a serverless runtime the invocation can be frozen the moment
  // the response is sent, so the inserts that had not landed never did.
  it("has written them before it answers", async () => {
    withItems(["Ana: Wire the funds", "Circulate the memo"]);
    wire();
    await POST(req());
    expect(createTeamTask).toHaveBeenCalledTimes(2);
  });

  it("reports what it created", async () => {
    withItems(["Ana: Wire the funds"]);
    wire();
    const body = await (await POST(req())).json();
    expect(body.tasks).toMatchObject({ created: 1 });
  });

  it("keeps them with the host when the directory cannot be read", async () => {
    // loadOrgDirectory fails closed. That must mean the host, never a guess.
    withItems(["Ana: Wire the funds"]);
    wire();
    await POST(req());
    expect(taskInputs()[0].assignedTo).toBe("host-1");
  });

  it("stamps the meeting on each task, so a retry does not raise it twice", async () => {
    withItems(["Ana: Wire the funds"]);
    wire();
    await POST(req());
    expect(taskInputs()[0].meetingId).toBe("m1");
  });

  it("raises nothing when the report had no action items", async () => {
    withItems([]);
    wire();
    await POST(req());
    expect(createTeamTask).not.toHaveBeenCalled();
  });
});

describe("a call with nothing transcribed", () => {
  const silent = () =>
    new Request("http://localhost/api/meetings/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingId: "m1", transcript: "   ", duration: 240 }),
    });

  // A one-way call recorded in a browser with no speech recognition — or one
  // where nobody said anything it caught — has audio and no words. That is an
  // ordinary outcome, and this route is the ONLY thing that ever marks a
  // session ended: refusing left the call open forever and sent the person to a
  // report page that generated a summary which was never coming.
  it("closes out a one-way call instead of refusing it", async () => {
    wire({ meeting: { ...MEETING, kind: "one_way" } });
    const res = await POST(silent());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, summarised: false });
    expect(writes.meetingUpdate).toMatchObject({ status: "ended" });
    // A report row exists, so the report page renders an empty report rather
    // than waiting for one.
    expect(writes.reports).toHaveLength(1);
    expect(generateMeetingReport).not.toHaveBeenCalled();
  });

  // For a meeting the refusal stands: one with no transcript at all either did
  // not happen or is a bug, and writing an empty report over it buries that.
  it("still refuses a meeting with no transcript", async () => {
    wire();
    expect((await POST(silent())).status).toBe(400);
    expect(writes.reports).toHaveLength(0);
    expect(writes.meetingUpdate).toBeUndefined();
  });

  it("still refuses a request with no meeting at all", async () => {
    wire();
    const res = await POST(new Request("http://localhost/api/meetings/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: "words" }),
    }));
    expect(res.status).toBe(400);
  });
});

describe("after the report is written", () => {
  it("raises action-item tasks without waiting for the meeting record", async () => {
    wire();
    generateMeetingReport.mockResolvedValue({
      summary: "They agreed to wire on Friday.",
      key_points: [],
      action_items: ["Send the wire instructions"],
      decisions: [],
    });
    createTeamTask.mockResolvedValue({ id: "t1" });
    // The record never finishes until released, so the task can only have been
    // created if the two ran side by side rather than one after the other.
    let release!: () => void;
    persistInstitutionalMeetingRecord.mockReturnValue(new Promise<void>((r) => { release = r; }));

    const pending = POST(req());
    for (let i = 0; i < 20 && createTeamTask.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(createTeamTask).toHaveBeenCalled();
    expect(writes.meetingUpdate).toMatchObject({ status: "ended" });

    release();
    expect((await pending).status).toBe(200);
  });
});
