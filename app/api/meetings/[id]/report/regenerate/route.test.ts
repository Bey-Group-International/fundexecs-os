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
const createActionItemTasks = jest.fn();

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
  EMPTY_REPORT: { summary: "", key_points: [], action_items: [], decisions: [] },
  generateMeetingReport: (...a: unknown[]) => generateMeetingReport(...a),
}));
jest.mock("@/lib/meetings/action-items.server", () => ({
  createActionItemTasks: (...a: unknown[]) => createActionItemTasks(...a),
}));
jest.mock("@/lib/meetings/directory.server", () => ({ loadOrgDirectory: async () => [] }));

import { POST, maxDuration } from "./route";
import { NOISE_NOTE } from "@/lib/meetings/transcript-quality";
import { UNSUMMARISED_KEY } from "@/lib/meetings/report-generation";

const params = { params: Promise.resolve({ id: "m1" }) };
const req = () => new Request("http://localhost/api/meetings/m1/report/regenerate", { method: "POST" });

const MEETING = {
  id: "m1", room_code: "abc-def-gh", title: "LP Update", host_id: "host-1",
  organization_id: "org1", attendees: [{ name: "Ana", email: "ana@f.test" }],
  created_at: "2026-03-01T10:00:00Z", started_at: null, ended_at: "2026-03-01T11:00:00Z",
  scheduled_at: "2026-03-01T10:00:00Z", duration_minutes: 60, status: "ended", is_draft: false,
};

/**
 * Records what the route wrote, BY TABLE.
 *
 * The table matters: the point of this route is that it never updates a report
 * row, while it does update the meeting's follow-up badge. One `updated` slot
 * for both made those indistinguishable.
 */
const writes: { inserted?: Record<string, unknown>; updated?: Record<string, unknown> } = {};
const updatesByTable: Record<string, unknown[]> = {};

function wire({
  meeting = MEETING as unknown,
  report = { id: "r1", full_transcript: "Ana: we agreed to wire on Friday." } as unknown,
  insertResult = { data: { summary: "s", key_points: [], action_items: [], analysis: {} }, error: null },
  present = [] as Array<Record<string, unknown>>,
  rows = [] as Array<Record<string, unknown>>,
}: {
  meeting?: unknown;
  report?: unknown;
  insertResult?: unknown;
  /** Attendance rows, as loadPresentPeople reads them. */
  present?: Array<Record<string, unknown>>;
  /** The rows the call itself wrote to live_meeting_transcripts. */
  rows?: Array<Record<string, unknown>>;
} = {}) {
  from.mockImplementation((table: string) => {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, is: () => b, order: () => b, limit: () => b,
      maybeSingle: async () => ({ data: table === "live_meetings" ? meeting : report, error: null }),
      // The paged transcript read. One page, short, so it is also the last.
      range: async () => ({ data: table === "live_meeting_transcripts" ? rows : [], error: null }),
      insert: (row: Record<string, unknown>) => { writes.inserted = row; return b; },
      update: (row: unknown) => {
        (updatesByTable[table] ??= []).push(row);
        if (table === "live_meetings") writes.updated = row as Record<string, unknown>;
        return b;
      },
      single: async () => insertResult,
      // Awaited as the builder itself: the attendance read, and every update.
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === "live_meeting_participants" ? present : [], error: null }).then(resolve),
    };
    return b;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  writes.inserted = undefined;
  writes.updated = undefined;
  for (const key of Object.keys(updatesByTable)) delete updatesByTable[key];
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "host-1" } });
  gateConversationalSpend.mockResolvedValue({ ok: true });
  createActionItemTasks.mockResolvedValue({ created: 0, routed: 0, unrouted: [], skipped: 0 });
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
  // The Gary Jinks meeting: 64 minutes whose transcript is a noisy room and a
  // smart speaker recognised as fluent English. Every one of those lines used to
  // reach the summariser, which is why the only honest report it could produce
  // was an apology — and why on another day it might instead have summarised
  // decisions nobody made.
  const NOISE = NOISE_NOTE;
  const BAD = [
    "Gary: so where did we land on the close",
    `Gary (${NOISE}): Shah Rukh Khan`,
    `Astin (${NOISE}): Rusher Rashad`,
    "Astin: Alexa, search the shopping list",
    "Astin: the week after next works",
  ].join("\n");

  it("withholds recognised noise and voice-assistant orders from the model", async () => {
    wire({ report: { id: "r1", full_transcript: BAD } });
    await POST(req(), params);
    const sent = generateMeetingReport.mock.calls[0][2] as { transcript: string };
    expect(sent.transcript).toContain("so where did we land on the close");
    expect(sent.transcript).toContain("the week after next works");
    expect(sent.transcript).not.toContain("Shah Rukh Khan");
    expect(sent.transcript).not.toContain("Rusher Rashad");
    expect(sent.transcript).not.toContain("shopping list");
  });

  it("tells the model how much was withheld and why", async () => {
    wire({ report: { id: "r1", full_transcript: BAD } });
    await POST(req(), params);
    const sent = generateMeetingReport.mock.calls[0][2] as { transcript: string };
    // So the summary reports an audio problem as a fact rather than inferring one
    // from gibberish — and so a floor set in the wrong place shows up in the
    // output instead of silently eating a meeting.
    expect(sent.transcript).toContain("[audio quality]");
    expect(sent.transcript).toContain("hearing noise rather than words");
    expect(sent.transcript).toContain("commands to a voice assistant");
  });

  it("stores the whole record, unfiltered and with no note of its own", async () => {
    // The transcript is the record of what the room heard and is not ours to
    // edit. Only the model's copy is filtered — and baking the note into the
    // stored text would re-prepend it on every later regenerate.
    wire({ report: { id: "r1", full_transcript: BAD } });
    await POST(req(), params);
    expect(writes.inserted).toMatchObject({ full_transcript: BAD });
  });

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

  // `duration_minutes` is the BOOKED length. Handing it to the model as the
  // duration had a 64-minute call summarised as a 30-minute one.
  it("tells the model how long the meeting actually ran, never how long it was booked for", async () => {
    wire({ meeting: { ...MEETING, started_at: "2026-03-01T10:00:00Z", ended_at: "2026-03-01T11:04:13Z" } });
    await POST(req(), params);
    expect(generateMeetingReport.mock.calls[0][2]).toMatchObject({ durationSeconds: 3853 });
  });

  it("tells the model nothing about duration when the span was never measured", async () => {
    wire();
    await POST(req(), params);
    expect(generateMeetingReport.mock.calls[0][2]).toMatchObject({ durationSeconds: null });
  });

  it("names who was in the room and who spoke — never the invite list", async () => {
    // The end-of-meeting route builds this list the same way, so the two
    // reports of one meeting agree about who had it. The invite list names
    // people who may never have joined.
    wire({
      meeting: { ...MEETING, attendees: [{ name: "Never Joined", email: "nj@f.test" }] },
      present: [{ user_id: null, guest_key: "g1", display_name: "Dana" }],
      report: { id: "r1", full_transcript: "Ana: we agreed to wire on Friday.\nBo: fine." },
    });
    await POST(req(), params);
    const sent = generateMeetingReport.mock.calls[0][2] as { participants: string[] };
    expect(sent.participants).toEqual(["Dana", "Ana", "Bo"]);
  });

  it("reads the rows the call wrote even when there is no report row at all", async () => {
    wire({ report: null, rows: [{ speaker: "Ana", text: "wire on Friday", ts: "2026-03-01T10:05:00Z", confidence: 0.9, overlapped: false }] });
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(generateMeetingReport.mock.calls[0][2]).toMatchObject({ transcript: "Ana: wire on Friday" });
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
    // The log shows the newest report and keeps the previous one readable, so
    // nothing here may rewrite a report row that somebody may have relied on.
    expect(updatesByTable["live_meeting_reports"]).toBeUndefined();
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

  it("marks the entry as the host's, so the button survives its own use", async () => {
    wire();
    const json = (await (await POST(req(), params)).json()) as { entry: Record<string, unknown> };
    // MeetingLogs gates the regenerate action on `entry.isHost && entry.hasReport`
    // and swaps this entry in over the old one. Only the host reaches this
    // route at all, so an entry that comes back with isHost false makes the
    // button vanish the first time it is pressed.
    expect(json.entry.isHost).toBe(true);
  });

  it("leaves the replaced row still regenerable", async () => {
    wire();
    const json = (await (await POST(req(), params)).json()) as { entry: Record<string, unknown> };
    // The log swaps this entry in over the old one and gates the button on
    // canRegenerate. The row just written holds the same transcript this route
    // read to write it, so the button has to survive its own use here too.
    expect(json.entry.canRegenerate).toBe(true);
  });
});

describe("a meeting nobody ended", () => {
  // A host who shut the laptop instead of pressing End left the meeting
  // `active`, its transcript in the table, and no route that could write the
  // report without the room. This is now the first report as well as the next.
  const OPEN = { ...MEETING, status: "active", ended_at: null, started_at: null };
  const ROWS = [
    { speaker: "Ana", text: "we agreed to wire on Friday", ts: "2026-03-01T10:05:00Z", confidence: 0.9, overlapped: false },
    { speaker: "Bo", text: "fine", ts: "2026-03-01T10:40:00Z", confidence: 0.9, overlapped: false },
  ];

  it("writes the first report and marks the meeting ended", async () => {
    wire({ meeting: OPEN, report: null, rows: ROWS });
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(writes.inserted).toMatchObject({ meeting_id: "m1", summary: "They agreed to wire on Friday." });
    const close = updatesByTable["live_meetings"]!.find((u) => (u as { status?: string }).status === "ended") as Record<string, unknown>;
    expect(close).toMatchObject({ status: "ended" });
    expect(typeof close.ended_at).toBe("string");
    // The start the room never wrote, from the first thing anyone said.
    expect(close.started_at).toBe("2026-03-01T10:05:00.000Z");
  });

  it("hands back an entry dated by the end it just recorded, so it lands in the log", async () => {
    wire({ meeting: OPEN, report: null, rows: ROWS });
    const json = (await (await POST(req(), params)).json()) as { entry: { occurredAt: string } };
    expect(Number.isFinite(Date.parse(json.entry.occurredAt))).toBe(true);
    expect(Date.parse(json.entry.occurredAt)).toBeGreaterThan(Date.parse("2026-03-01T10:40:00Z"));
  });

  it("leaves an ended meeting's end alone", async () => {
    wire();
    await POST(req(), params);
    expect(updatesByTable["live_meetings"]!.some((u) => (u as { status?: string }).status === "ended")).toBe(false);
  });
});

describe("a transcript that is noise and nothing else", () => {
  const UNUSABLE = [
    "Gary: so where did we land on the close",
    ...Array.from({ length: 6 }, (_, i) => `Gary (${NOISE_NOTE}): garble ${i}`),
  ].join("\n");

  it("is filed as a finished, empty report without asking the model or charging for it", async () => {
    wire({ report: { id: "r1", full_transcript: UNUSABLE, summary: "" } });
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ unsummarised: true, reason: "unusable" });
    expect(generateMeetingReport).not.toHaveBeenCalled();
    expect(gateConversationalSpend).not.toHaveBeenCalled();
    expect(writes.inserted).toMatchObject({ summary: "", full_transcript: UNUSABLE });
    expect((writes.inserted!.analysis as Record<string, unknown>)[UNSUMMARISED_KEY]).toBe("unusable");
  });

  it("never replaces a real report with an empty one", async () => {
    wire({ report: { id: "r1", full_transcript: UNUSABLE, summary: "A real summary from before." } });
    const res = await POST(req(), params);
    expect(res.status).toBe(409);
    expect(writes.inserted).toBeUndefined();
  });
});

describe("the function envelope", () => {
  it("is declared, matching the end-of-meeting route", () => {
    expect(maxDuration).toBe(300);
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

describe("a regenerated report reaches the people it names", () => {
  // A host regenerates because the first report read wrong. The corrected
  // action items used to go nowhere: the new report said Ana owed something
  // and nothing ever told Ana.
  it("raises the corrected action items", async () => {
    wire();
    await POST(req(), params);
    expect(createActionItemTasks).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ meetingId: "m1", items: ["Ana: wire Friday"], hostId: "host-1" }),
    );
  });

  // Safe only because createActionItemTasks skips what this meeting already
  // raised — otherwise every regeneration would file the lot again.
  it("hands it the meeting, which is how the unchanged items are left alone", async () => {
    wire();
    await POST(req(), params);
    expect(createActionItemTasks.mock.calls[0][1]).toMatchObject({ meetingId: "m1" });
  });

  it("moves the follow-up badge with the report it replaced", async () => {
    wire();
    await POST(req(), params);
    expect(writes.updated).toEqual({ followup_status: "draft" });
  });

  it("clears the badge when the new report has no follow-up", async () => {
    generateMeetingReport.mockResolvedValue({
      summary: "They agreed to wire on Friday.",
      key_points: [], action_items: [], decisions: [],
      sentiment: "neutral", next_meeting_suggestion: "", follow_up_draft: "",
    });
    wire();
    await POST(req(), params);
    expect(writes.updated).toEqual({ followup_status: "not_started" });
  });
});

describe("after the new report is saved", () => {
  it("moves the follow-up badge without waiting for the action-item tasks", async () => {
    wire();
    let release!: () => void;
    createActionItemTasks.mockReturnValue(
      new Promise((r) => { release = () => r({ created: 1, routed: 0, unrouted: [], skipped: 0 }); }),
    );

    const pending = POST(req(), params);
    for (let i = 0; i < 20 && !writes.updated; i++) {
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(createActionItemTasks).toHaveBeenCalled();
    expect(writes.updated).toMatchObject({ followup_status: "draft" });

    release();
    expect((await pending).status).toBe(200);
  });
});

describe("a correction from the host", () => {
  const correctionReq = (correction: unknown) =>
    new Request("http://localhost/api/meetings/m1/report/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correction }),
    });

  it("is handed to the model with the version it corrects", async () => {
    wire({
      report: {
        id: "r1",
        full_transcript: "Ana: we agreed to wire on Friday.",
        summary: "Old summary",
        analysis: { follow_up_draft: "Hi Host," },
      },
    });
    await POST(correctionReq("  The follow-up is to Ana, not me.  "), params);
    expect(generateMeetingReport.mock.calls[0][2]).toMatchObject({
      correction: "The follow-up is to Ana, not me.",
      previous: { summary: "Old summary", followUp: "Hi Host," },
    });
  });

  it("is kept on the new version so the history can say why it exists", async () => {
    wire();
    await POST(correctionReq("Mark owns the deck."), params);
    expect((writes.inserted?.analysis as Record<string, unknown>).correction_note).toBe("Mark owns the deck.");
  });

  it("is absent from a plain regenerate", async () => {
    wire();
    await POST(req(), params);
    expect(generateMeetingReport.mock.calls[0][2]).toMatchObject({ correction: null, previous: null });
    expect((writes.inserted?.analysis as Record<string, unknown>).correction_note).toBeUndefined();
  });

  it("tells the model who the host is, not only who was invited", async () => {
    wire();
    await POST(req(), params);
    expect(generateMeetingReport.mock.calls[0][2]).toHaveProperty("host");
    expect(generateMeetingReport.mock.calls[0][2]).toHaveProperty("recipients");
  });
});
