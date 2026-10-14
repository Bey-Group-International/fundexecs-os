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
import { MAX_PAGES, MAX_REPORTS_PER_SWEEP, runStaleMeetingSweep } from "./stale-meeting-sweep.server";

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
  /** Activity reads made, per table, for counting what a meeting cost. */
  reads: { participants: number; transcripts: number };
  /** Pages of open meetings read. */
  pages: number;
}

function client(w: World) {
  return {
    from: (table: string) => {
      let meetingId: unknown = null;
      let descending = false;
      let after: string | null = null;
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
        // The keyset cursor: `created_at.gt.X,and(created_at.eq.X,id.gt.ID)`. The
        // world is already in (created_at, id) order, so the id is enough.
        or: (expr: string) => { after = /id\.gt\.([^)]+)\)/.exec(expr)?.[1] ?? null; return chain; },
        order: (_col: string, o?: { ascending?: boolean }) => { descending = o?.ascending === false; return chain; },
        limit: async (n: number) => {
          if (table === "live_meetings") {
            w.pages += 1;
            const from = after === null ? 0 : w.meetings.findIndex((m) => m.id === after) + 1;
            return { data: w.meetings.slice(from, from + n), error: null };
          }
          if (table === "live_meeting_participants") {
            w.reads.participants += 1;
            return { data: w.participants[String(meetingId)] ?? [], error: null };
          }
          if (table === "live_meeting_transcripts") {
            w.reads.transcripts += 1;
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
  return {
    meetings: [], participants: {}, transcripts: {}, filters: [],
    reads: { participants: 0, transcripts: 0 }, pages: 0, ...over,
  };
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

describe("walking the whole set of candidates", () => {
  // The bug this exists for: the sweep read the fifty oldest open meetings and
  // stopped. Meetings that were booked and never held show no sign of life, so
  // they are never closed and pile up at the old end of that order; once there
  // were a page of them, every real abandoned meeting behind was out of reach.
  const neverHeld = (n: number) =>
    Array.from({ length: n }, (_, i) => meeting({
      id: `held-${String(i).padStart(3, "0")}`, status: "waiting",
      created_at: ago((100 - i) * H), scheduled_at: ago((60 - i) * H),
    }));

  it("reaches an abandoned meeting that sits behind a full page of never-held ones", async () => {
    const w = world({
      meetings: [...neverHeld(5), meeting({ id: "real", status: "active", created_at: ago(30 * H) })],
    });
    const stats = await runStaleMeetingSweep(client(w), { now: NOW, client: null, model: "t", limit: 2 });
    expect(stats).toMatchObject({ candidates: 6, closed: 1, failed: 0 });
    expect(closeMeeting).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      meeting: expect.objectContaining({ id: "real" }),
    }));
    expect(w.pages).toBeGreaterThan(1);
  });

  it("does not skip a meeting when the one before it is closed mid-walk", async () => {
    // Closing takes a meeting out of the set. A page offset would then jump
    // over whoever slid into its place.
    const w = world({
      meetings: ["a", "b", "c", "d", "e"].map((id, i) => meeting({ id, created_at: ago((50 - i) * H) })),
    });
    closeMeeting.mockImplementation(async (_s: unknown, { meeting: m }: { meeting: Row }) => {
      w.meetings = w.meetings.filter((x) => x.id !== m.id);
      return { endedAt: "x", startedAt: null };
    });
    const stats = await runStaleMeetingSweep(client(w), { now: NOW, client: null, model: "t", limit: 2 });
    expect(stats.closed).toBe(5);
    expect(closeMeeting).toHaveBeenCalledTimes(5);
  });

  it("spends no reads on a meeting still booked for later", async () => {
    const w = world({
      meetings: [
        meeting({ id: "future", status: "waiting", scheduled_at: new Date(NOW.getTime() + 24 * H).toISOString() }),
        meeting({ id: "just-over", status: "waiting", scheduled_at: ago(1 * H) }),
      ],
    });
    await sweep(w);
    // Neither can be abandoned yet (the later one is not due, the other is only
    // an hour past its time), so neither costs a participants or transcripts read.
    expect(w.reads.participants + w.reads.transcripts).toBe(0);
    expect(closeMeeting).not.toHaveBeenCalled();
  });

  it("still spends at most one model call, oldest first, across pages", async () => {
    const w = world({
      meetings: ["a", "b", "c"].map((id, i) => meeting({ id, created_at: ago((50 - i) * H) })),
      transcripts: { a: [{ ts: ago(10 * H) }], b: [{ ts: ago(10 * H) }], c: [{ ts: ago(10 * H) }] },
    });
    const stats = await runStaleMeetingSweep(client(w), { now: NOW, client: null, model: "t", limit: 1 });
    expect(stats).toMatchObject({ reported: MAX_REPORTS_PER_SWEEP, deferred: 2 });
    const [, input] = generateReportFromStoredTranscript.mock.calls[0];
    expect(input.meeting.id).toBe("a");
  });

  it("stops walking when it is out of time and leaves the rest for the next pass", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const w = world({ meetings: neverHeld(6) });
    await runStaleMeetingSweep(client(w), { now: NOW, client: null, model: "t", limit: 2, budgetMs: -1 });
    expect(w.pages).toBe(1);
    warn.mockRestore();
  });

  it("is bounded in pages, so a runaway set cannot hold the cron", async () => {
    const w = world({ meetings: neverHeld(MAX_PAGES * 2 + 6) });
    await runStaleMeetingSweep(client(w), { now: NOW, client: null, model: "t", limit: 2 });
    expect(w.pages).toBe(MAX_PAGES);
  });
});
