/**
 * The report page's states.
 *
 * Every decision this page makes now lives in attendance.ts and is tested
 * there. This covers the WIRING, which is where both of the day's defects
 * actually were: the rules were fine and the page asked them the wrong
 * question, then re-read the whole transcript while waiting on the answer.
 *
 * Specifically:
 *
 *   A report row with an empty summary is FINISHED. The route writes one when
 *   the model fails and again when a one-way call had nothing to transcribe.
 *   Keyed on the summary, the page called that "generating" — a permanent
 *   spinner, polling every five seconds for the life of the tab, over a
 *   recording and transcript that were fully readable behind it.
 *
 *   And readAllTranscriptRows sat inside the poll body, so a long meeting
 *   re-paged every row it had every five seconds, forever.
 */

import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";

jest.mock("next/navigation", () => ({ useParams: () => ({ roomId: "abc-def-gh" }) }));

/** Every table read, so a test can count them and see what was asked for. */
let reads: string[] = [];
let transcriptRangeCalls = 0;

/** What the fake database answers with. Mutable, so a poll can see a change. */
const db: {
  meeting: Record<string, unknown> | null;
  report: Record<string, unknown> | null;
  attended: boolean;
} = { meeting: null, report: null, attended: false };

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "host-1" } } }) },
    from: (table: string) => {
      reads.push(table);
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        range: async () => {
          transcriptRangeCalls += 1;
          return { data: [], error: null };
        },
        maybeSingle: async () => {
          if (table === "live_meetings") return { data: db.meeting, error: null };
          if (table === "live_meeting_reports") return { data: db.report, error: null };
          if (table === "live_meeting_participants") {
            return { data: db.attended ? { meeting_id: "m1" } : null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
  }),
}));

// The panels do their own fetching and none of it is what this file is about.
jest.mock("./RecordingPanel", () => ({ RecordingPanel: () => <div data-testid="recording-panel" /> }));
jest.mock("./ChatPanel", () => ({ ChatPanel: () => null }));
jest.mock("./ExportMenu", () => ({ ExportMenu: () => null }));
jest.mock("./FollowUpPanel", () => ({ FollowUpPanel: () => null }));

import MeetingReportPage from "./page";

const MEETING = {
  id: "m1",
  host_id: "host-1",
  title: "Dunbar follow-up",
  created_at: "2026-09-23T14:00:00.000Z",
  started_at: "2026-09-23T14:00:00.000Z",
  ended_at: "2026-09-23T14:40:00.000Z",
  scheduled_at: null,
  kind: "meeting",
  recording_consent: null,
};

beforeEach(() => {
  jest.useFakeTimers();
  reads = [];
  transcriptRangeCalls = 0;
  db.meeting = { ...MEETING };
  db.report = null;
  db.attended = true;
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

/** Let the page's awaited reads settle without advancing the poll clock. */
async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

/** Advance past one poll interval. */
async function poll() {
  await act(async () => { jest.advanceTimersByTime(5_000); });
  await settle();
}

describe("a report that exists without a summary", () => {
  const unsummarised = { summary: "", key_points: [], action_items: [], analysis: {}, full_transcript: "" };

  it("is rendered, not hidden behind a spinner", async () => {
    db.report = { ...unsummarised };
    render(<MeetingReportPage />);
    await settle();

    // The meeting's own title, which only the rendered report shows.
    expect(await screen.findByText("Dunbar follow-up")).toBeInTheDocument();
    expect(screen.getByText(/No summary was written/i)).toBeInTheDocument();
    expect(screen.queryByText(/Generating your report/i)).toBeNull();
  });

  // The recording is the thing worth having when there is no summary, and it
  // was the thing the spinner covered up.
  it("still shows the recording", async () => {
    db.report = { ...unsummarised };
    render(<MeetingReportPage />);
    await settle();
    expect(screen.getByTestId("recording-panel")).toBeInTheDocument();
  });

  it("stops polling, rather than asking forever", async () => {
    db.report = { ...unsummarised };
    render(<MeetingReportPage />);
    await settle();

    const after = reads.length;
    await poll();
    await poll();
    expect(reads.length).toBe(after);
  });

  // A one-way call whose MODEL failed has a real transcript, so the copy must
  // not claim nothing was transcribed above the words themselves.
  it("blames the analysis, not the microphone, when there are words", async () => {
    db.meeting = { ...MEETING, kind: "one_way" };
    db.report = { ...unsummarised, full_transcript: "Priya: we agreed on Friday." };
    render(<MeetingReportPage />);
    await settle();

    expect(screen.getByText(/analysis could not be completed/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing was transcribed/i)).toBeNull();
  });

  it("says nothing was transcribed only when nothing was", async () => {
    db.meeting = { ...MEETING, kind: "one_way" };
    db.report = { ...unsummarised, full_transcript: "" };
    render(<MeetingReportPage />);
    await settle();
    expect(screen.getByText(/Nothing was transcribed/i)).toBeInTheDocument();
  });
});

describe("a report that has not been written", () => {
  it("waits, and keeps asking", async () => {
    db.report = null;
    render(<MeetingReportPage />);
    await settle();

    expect(screen.getByText(/Generating your report/i)).toBeInTheDocument();
    const after = reads.length;
    await poll();
    expect(reads.length).toBeGreaterThan(after);
  });

  it("renders it once it arrives", async () => {
    db.report = null;
    render(<MeetingReportPage />);
    await settle();
    expect(screen.getByText(/Generating your report/i)).toBeInTheDocument();

    db.report = {
      summary: "They agreed to wire on Friday.",
      key_points: ["Timing"],
      action_items: [],
      analysis: {},
      full_transcript: "Ana: Friday.",
    };
    await poll();

    await waitFor(() => expect(screen.getByText("They agreed to wire on Friday.")).toBeInTheDocument());
  });
});

describe("the timed transcript read", () => {
  // It used to sit in the poll body, so a two-hour meeting re-paged every row
  // it had every five seconds — and forever, while the summary bug held the
  // page in "generating".
  it("is not repeated on every poll", async () => {
    db.report = null;
    render(<MeetingReportPage />);
    await settle();
    const afterMount = transcriptRangeCalls;
    expect(afterMount).toBeGreaterThan(0);

    await poll();
    await poll();
    await poll();
    expect(transcriptRangeCalls).toBe(afterMount);
  });

  // But once is wrong too: people are sent here the instant a meeting ends,
  // while the last transcript flushes are still in flight, so the read taken on
  // arrival can be missing the end of the meeting. The second one is taken when
  // the report appears, which the route writes after the transcript.
  it("is taken again once the report arrives", async () => {
    db.report = null;
    render(<MeetingReportPage />);
    await settle();
    const afterMount = transcriptRangeCalls;

    db.report = { summary: "Done.", key_points: [], action_items: [], analysis: {}, full_transcript: "x" };
    await poll();

    expect(transcriptRangeCalls).toBeGreaterThan(afterMount);
  });
});

describe("who may read it", () => {
  it("says so plainly to someone who was not there", async () => {
    db.meeting = { ...MEETING, host_id: "someone-else" };
    db.attended = false;
    db.report = null;
    render(<MeetingReportPage />);
    await settle();

    // The defect this replaced: RLS hides the report from a non-attendee,
    // which looks exactly like a report still being written.
    expect(screen.queryByText(/Generating your report/i)).toBeNull();
    const after = reads.length;
    await poll();
    expect(reads.length).toBe(after);
  });

  it("reports a meeting that is not there", async () => {
    db.meeting = null;
    render(<MeetingReportPage />);
    await settle();
    expect(screen.getByText(/Meeting not found/i)).toBeInTheDocument();
  });
});

describe("a report that is never coming", () => {
  it("gives up and explains, rather than spinning for the life of the tab", async () => {
    db.report = null;
    render(<MeetingReportPage />);
    await settle();
    expect(screen.getByText(/Generating your report/i)).toBeInTheDocument();

    // Past the derived wait limit (360s), one poll at a time.
    for (let i = 0; i < 75; i++) await poll();

    expect(screen.getByText(/has no report yet/i)).toBeInTheDocument();
    const after = reads.length;
    await poll();
    expect(reads.length).toBe(after);
  });
});

describe("a recorded call's own facts", () => {
  it("shows the consent that was acknowledged before recording", async () => {
    db.meeting = {
      ...MEETING,
      kind: "one_way",
      started_at: null,
      recording_consent: {
        at: "2026-09-23T14:00:00.000Z",
        disclosure: "I am recording this call. Is that all right?",
        sources: ["microphone"],
      },
    };
    db.report = { summary: "A call.", key_points: [], action_items: [], analysis: {}, full_transcript: "x" };
    render(<MeetingReportPage />);
    await settle();

    // Stored so somebody can answer "should this have been recorded?" — and
    // until now shown on every page except the one they would ask it on.
    expect(screen.getByText(/Consent recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/I am recording this call/i)).toBeInTheDocument();
  });

  it("shows no consent block for an ordinary meeting", async () => {
    db.report = { summary: "A meeting.", key_points: [], action_items: [], analysis: {}, full_transcript: "x" };
    render(<MeetingReportPage />);
    await settle();
    expect(screen.queryByText(/Consent recorded/i)).toBeNull();
  });
});
