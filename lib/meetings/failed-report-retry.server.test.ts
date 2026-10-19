/**
 * The hourly retry for reports the model never wrote.
 *
 * The decisions that matter: it touches only a meeting whose NEWEST report is
 * blank and not blank on purpose, only while the meeting is ended, it spends
 * one model call a pass, and a billing refusal stops it rather than being
 * counted as one more failure to retry.
 */
const generateReportFromStoredTranscript = jest.fn();

jest.mock("@/lib/meetings/report-generation.server", () => ({
  generateReportFromStoredTranscript: (...a: unknown[]) => generateReportFromStoredTranscript(...a),
}));
jest.mock("@/lib/anthropic-client", () => ({ anthropicClient: () => ({}), LONG_RUN_TIMEOUT_MS: 1 }));

import { MAX_RETRIES_PER_PASS, isBillingRefusal, runFailedReportRetry } from "./failed-report-retry.server";

const NOW = new Date("2026-10-19T15:00:00.000Z");

type Row = Record<string, unknown>;

interface World {
  /** Blank reports, newest first. */
  blank: Row[];
  /** Newest report id per meeting. */
  latest: Record<string, string>;
  meetings: Record<string, Row>;
  readError?: string;
}

function client(w: World) {
  return {
    from: (table: string) => {
      let meetingId: unknown = null;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: unknown) => {
          if (col === "meeting_id" || col === "id") meetingId = v;
          return chain;
        },
        gte: () => chain,
        order: () => chain,
        limit: async () =>
          table === "live_meeting_reports" && !meetingId
            ? { data: w.readError ? null : w.blank, error: w.readError ? { message: w.readError } : null }
            : { data: [], error: null },
        maybeSingle: async () => {
          if (table === "live_meeting_reports") {
            const id = w.latest[String(meetingId)];
            return { data: id ? { id } : null, error: null };
          }
          return { data: w.meetings[String(meetingId)] ?? null, error: null };
        },
      };
      // `limit` is awaited directly for the list read and chained into
      // `maybeSingle` for the per-meeting read; make it do both.
      const limit = chain.limit as () => Promise<unknown>;
      chain.limit = () => Object.assign(limit(), { maybeSingle: chain.maybeSingle });
      return chain;
    },
  } as never;
}

const report = (id: string, meetingId: string, analysis: Row | null = {}): Row => ({
  id, meeting_id: meetingId, analysis,
});
const meeting = (id: string, over: Row = {}): Row => ({
  id, title: "LP call", host_id: "h", organization_id: "o", deal_id: null, attendees: [],
  status: "ended", started_at: null, ended_at: null, deleted_at: null, ...over,
});

const run = (w: World, over: Record<string, unknown> = {}) =>
  runFailedReportRetry(client(w), { now: NOW, client: {} as never, model: "test-model", ...over });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  generateReportFromStoredTranscript.mockResolvedValue({ kind: "written" });
});

describe("which blank reports it retries", () => {
  it("retries a blank newest report of an ended meeting", async () => {
    const w: World = {
      blank: [report("r1", "m1")], latest: { m1: "r1" }, meetings: { m1: meeting("m1") },
    };
    const stats = await run(w);
    expect(generateReportFromStoredTranscript).toHaveBeenCalledTimes(1);
    expect(stats).toMatchObject({ candidates: 1, retried: 1, failed: 0, billingBlocked: false });
  });

  it("leaves a report that is blank on purpose", async () => {
    const w: World = {
      blank: [report("r1", "m1", { unsummarised: "silent" })], latest: { m1: "r1" }, meetings: { m1: meeting("m1") },
    };
    await run(w);
    expect(generateReportFromStoredTranscript).not.toHaveBeenCalled();
  });

  it("leaves a meeting whose newest report is no longer the blank one", async () => {
    const w: World = {
      blank: [report("r1", "m1")], latest: { m1: "r2" }, meetings: { m1: meeting("m1") },
    };
    const stats = await run(w);
    expect(generateReportFromStoredTranscript).not.toHaveBeenCalled();
    expect(stats.candidates).toBe(0);
  });

  it("leaves meetings that are still open or deleted", async () => {
    const w: World = {
      blank: [report("r1", "m1"), report("r2", "m2")],
      latest: { m1: "r1", m2: "r2" },
      meetings: { m1: meeting("m1", { status: "active" }), m2: meeting("m2", { deleted_at: "2026-10-18T00:00:00Z" }) },
    };
    await run(w);
    expect(generateReportFromStoredTranscript).not.toHaveBeenCalled();
  });

  it("asks once per meeting even when it has several blank rows", async () => {
    const w: World = {
      blank: [report("r2", "m1"), report("r1", "m1")], latest: { m1: "r2" }, meetings: { m1: meeting("m1") },
    };
    const stats = await run(w);
    expect(stats.candidates).toBe(1);
    expect(generateReportFromStoredTranscript).toHaveBeenCalledTimes(1);
  });
});

describe("what it spends and how it fails", () => {
  it("makes at most one model call a pass", async () => {
    const w: World = {
      blank: [report("r1", "m1"), report("r2", "m2"), report("r3", "m3")],
      latest: { m1: "r1", m2: "r2", m3: "r3" },
      meetings: { m1: meeting("m1"), m2: meeting("m2"), m3: meeting("m3") },
    };
    const stats = await run(w);
    expect(MAX_RETRIES_PER_PASS).toBe(1);
    expect(generateReportFromStoredTranscript).toHaveBeenCalledTimes(1);
    expect(stats.candidates).toBe(3);
  });

  it("stops at a billing refusal and says so", async () => {
    generateReportFromStoredTranscript.mockRejectedValue(
      new Error('400 {"error":{"message":"Your credit balance is too low to access the Anthropic API."}}'),
    );
    const w: World = {
      blank: [report("r1", "m1")], latest: { m1: "r1" }, meetings: { m1: meeting("m1") },
    };
    const stats = await run(w);
    expect(stats).toMatchObject({ billingBlocked: true, failed: 0, retried: 0 });
  });

  it("counts any other model failure and carries on", async () => {
    generateReportFromStoredTranscript.mockRejectedValue(new Error("overloaded"));
    const w: World = {
      blank: [report("r1", "m1")], latest: { m1: "r1" }, meetings: { m1: meeting("m1") },
    };
    const stats = await run(w);
    expect(stats).toMatchObject({ billingBlocked: false, failed: 1 });
  });

  it("counts an empty answer as a failure, not a retry", async () => {
    generateReportFromStoredTranscript.mockResolvedValue({ kind: "empty" });
    const w: World = {
      blank: [report("r1", "m1")], latest: { m1: "r1" }, meetings: { m1: meeting("m1") },
    };
    const stats = await run(w);
    expect(stats).toMatchObject({ retried: 0, failed: 1 });
  });

  it("does nothing without an API key", async () => {
    const w: World = { blank: [report("r1", "m1")], latest: { m1: "r1" }, meetings: { m1: meeting("m1") } };
    const stats = await run(w, { client: null });
    expect(generateReportFromStoredTranscript).not.toHaveBeenCalled();
    expect(stats.candidates).toBe(0);
  });

  it("returns quietly when the blank reports cannot be read", async () => {
    const w: World = { blank: [], latest: {}, meetings: {}, readError: "boom" };
    await expect(run(w)).resolves.toMatchObject({ candidates: 0, retried: 0 });
  });
});

describe("isBillingRefusal", () => {
  it("recognises the credit message and nothing else", () => {
    expect(isBillingRefusal(new Error("400 Your credit balance is too low to access the Anthropic API."))).toBe(true);
    expect(isBillingRefusal(new Error("529 overloaded"))).toBe(false);
  });
});
