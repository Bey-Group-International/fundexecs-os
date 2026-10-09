/**
 * The hourly pass that closes meetings nobody ended.
 *
 * The decisions that matter: which open meetings it touches (never a meeting
 * still booked for later, never one that showed no sign of life), what it
 * writes for each (a report from the transcript, else an empty one), that it
 * dates the end by the last thing that happened, and that it spends at most
 * one model call a pass.
 */
const generateReportFromStoredTranscript = jest.fn();
const writeUnsummarisedReport = jest.fn();
const closeMeeting = jest.fn();

jest.mock("@/lib/meetings/report-generation.server", () => ({
  generateReportFromStoredTranscript: (...a: unknown[]) => generateReportFromStoredTranscript(...a),
  writeUnsummarisedReport: (...a: unknown[]) => writeUnsummarisedReport(...a),
  closeMeeting: (...a: unknown[]) => closeMeeting(...a),
}));
jest.mock("@/lib/anthropic-client", () => ({ anthropicClient: () => ({}), LONG_RUN_TIMEOUT_MS: 1 }));

import { STALE_MEETING_MS } from "./report-generation";
import { MAX_REPORTS_PER_SWEEP, runStaleMeetingSweep } from "./stale-meeting-sweep.server";

const NOW = new Date("2026-10-09T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const H = 3_600_000;

type Row = Record<string, unknown>;

interface World {
  meetings: Row[];
  participants: Record<string, Row[]>;
  transcripts: Record<string, Row[]>;
  /** What the open-meetings read was filtered by. */
  filters: Array<[string, unknown]>;
}

function client(w: World) {
  return {
    from: (table: string) => {
      let meetingId: unknown = null;
      let descending = false;
      const chain: Record<string, unknown> = {
        select: () => chain,
        in: (col: string, v: unknown) => { w.filters.push([col, v]); return chain; },
        is: (col: string, v: unknown) => { w.filters.push([col, v]); return chain; },
        eq: (col: string, v: unknown) => {
          if (col === "meeting_id") meetingId = v;
          else w.filters.push([col, v]);
          return chain;
        },
        lte: (col: string, v: unknown) => { w.filters.push([col, v]); return chain; },
        order: (_col: string, o?: { ascending?: boolean }) => { descending = o?.ascending === false; return chain; },
        limit: async (n: number) => {
          if (table === "live_meetings") return { data: w.meetings.slice(0, n), error: null };
          if (table === "live_meeting_participants") return { data: w.participants[String(meetingId)] ?? [], error: null };
          if (table === "live_meeting_transcripts") {
            const rows = [...(w.transcripts[String(meetingId)] ?? [])].sort((a, b) =>
              String(a.ts).localeCompare(String(b.ts)),
            );
            if (descending) rows.reverse();
            return { data: rows.slice(0, n), error: null };
          }
          return { data: [], error: null };
        },
      };
      return chain;
    },
  } as never;
}

function world(over: Partial<World> = {}): World {
  return { meetings: [], participants: {}, transcripts: {}, filters: [], ...over };
}

const meeting = (over: Row = {}): Row => ({
  id: "m1", title: "LP call", host_id: "host-1", organization_id: "org1", deal_id: null, attendees: [],
  status: "active", started_at: null, ended_at: null, scheduled_at: null, created_at: ago(26 * H),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  generateReportFromStoredTranscript.mockResolvedValue({ kind: "written" });
  writeUnsummarisedReport.mockResolvedValue(undefined);
  closeMeeting.mockResolvedValue({ endedAt: "x", startedAt: null });
});

const sweep = (w: World) => runStaleMeetingSweep(client(w), { now: NOW, client: null, model: "test-model" });

describe("which meetings it looks at", () => {
  it("asks only for open, undeleted, non-draft meetings old enough to be stale", async () => {
    const w = world();
    await sweep(w);
    expect(w.filters).toEqual(expect.arrayContaining([
      ["status", ["waiting", "active"]],
      ["deleted_at", null],
      ["is_draft", false],
      ["kind", "meeting"],
      ["created_at", ago(STALE_MEETING_MS)],
    ]));
  });
});

describe("a meeting with a transcript", () => {
  it("writes its report through the shared path and counts it", async () => {
    const w = world({
      meetings: [meeting()],
      transcripts: { m1: [{ ts: ago(5 * H) }, { ts: ago(4 * H) }] },
    });
    const stats = await sweep(w);
    expect(stats).toMatchObject({ candidates: 1, reported: 1, closed: 0, failed: 0 });
    expect(generateReportFromStoredTranscript).toHaveBeenCalledTimes(1);
    const [, input] = generateReportFromStoredTranscript.mock.calls[0];
    expect(input).toMatchObject({ meeting: expect.objectContaining({ id: "m1" }), hostEmail: null, model: "test-model" });
    // Dated by the last thing that happened, not by when the sweep noticed.
    expect(input.endedAt).toBe(ago(4 * H));
  });

  it("leaves one still being spoken in alone", async () => {
    const w = world({ meetings: [meeting()], transcripts: { m1: [{ ts: ago(5 * H) }, { ts: ago(20 * 60_000) }] } });
    const stats = await sweep(w);
    expect(stats).toMatchObject({ candidates: 1, reported: 0, closed: 0 });
    expect(generateReportFromStoredTranscript).not.toHaveBeenCalled();
    expect(closeMeeting).not.toHaveBeenCalled();
  });

  it("counts a report filed empty as closed, not as a model call", async () => {
    generateReportFromStoredTranscript.mockResolvedValue({ kind: "unsummarised", reason: "unusable", written: true });
    const w = world({ meetings: [meeting()], transcripts: { m1: [{ ts: ago(5 * H) }] } });
    expect(await sweep(w)).toMatchObject({ closed: 1, reported: 0 });
  });

  it("spends at most one model call a pass and defers the rest", async () => {
    const w = world({
      meetings: [meeting({ id: "m1" }), meeting({ id: "m2" }), meeting({ id: "m3" })],
      transcripts: { m1: [{ ts: ago(5 * H) }], m2: [{ ts: ago(5 * H) }], m3: [{ ts: ago(5 * H) }] },
    });
    const stats = await sweep(w);
    expect(generateReportFromStoredTranscript).toHaveBeenCalledTimes(MAX_REPORTS_PER_SWEEP);
    expect(stats).toMatchObject({ reported: 1, deferred: 2 });
  });

  it("charges a failed model call to the budget too, and leaves the meeting open", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    generateReportFromStoredTranscript.mockResolvedValue({ kind: "empty" });
    const w = world({
      meetings: [meeting({ id: "m1" }), meeting({ id: "m2" })],
      transcripts: { m1: [{ ts: ago(5 * H) }], m2: [{ ts: ago(5 * H) }] },
    });
    const stats = await sweep(w);
    expect(generateReportFromStoredTranscript).toHaveBeenCalledTimes(1);
    expect(stats).toMatchObject({ failed: 1, deferred: 1, reported: 0 });
    expect(closeMeeting).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("a meeting with no transcript", () => {
  it("is closed with an empty report, dated by the last departure", async () => {
    const w = world({
      meetings: [meeting({ status: "waiting" })],
      participants: { m1: [{ joined_at: ago(6 * H), left_at: ago(5 * H) }, { joined_at: ago(7 * H), left_at: ago(4 * H) }] },
    });
    const stats = await sweep(w);
    expect(stats).toMatchObject({ closed: 1, reported: 0 });
    expect(writeUnsummarisedReport).toHaveBeenCalledWith(expect.anything(), { meetingId: "m1", transcript: "", reason: "silent" });
    expect(closeMeeting).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      endedAt: ago(4 * H),
      firstJoinedAt: ago(7 * H),
    }));
    expect(generateReportFromStoredTranscript).not.toHaveBeenCalled();
  });

  it("never touches a booked meeting nobody has joined yet", async () => {
    // `waiting` from the day it was created, for a time still to come.
    const w = world({ meetings: [meeting({ status: "waiting", scheduled_at: new Date(NOW.getTime() + 24 * H).toISOString() })] });
    const stats = await sweep(w);
    expect(stats).toMatchObject({ candidates: 1, closed: 0, reported: 0 });
    expect(closeMeeting).not.toHaveBeenCalled();
    expect(writeUnsummarisedReport).not.toHaveBeenCalled();
  });

  it("never touches a waiting meeting that showed no sign of life at all", async () => {
    const w = world({ meetings: [meeting({ status: "waiting" })] });
    expect(await sweep(w)).toMatchObject({ closed: 0 });
    expect(closeMeeting).not.toHaveBeenCalled();
  });

  it("closes an active room that opened and was simply left", async () => {
    const w = world({ meetings: [meeting({ status: "active" })] });
    expect(await sweep(w)).toMatchObject({ closed: 1 });
  });
});

describe("resilience", () => {
  it("one meeting's failure does not stop the next", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    writeUnsummarisedReport.mockRejectedValueOnce(new Error("insert refused"));
    const w = world({ meetings: [meeting({ id: "m1" }), meeting({ id: "m2" })] });
    const stats = await sweep(w);
    expect(stats).toMatchObject({ failed: 1, closed: 1 });
    spy.mockRestore();
  });
});
