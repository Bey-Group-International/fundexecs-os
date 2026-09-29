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

/** Who the auth server says is reading, and how often it was asked. */
let authUser: { id: string } | null = { id: "host-1" };
let getUserCalls = 0;
/** The page's auth listeners, so a test can act like another tab. */
let authHandlers: Array<(event: string, session: { user: { id: string } } | null) => void> = [];
let unsubscribes = 0;

jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => {
        getUserCalls += 1;
        return { data: { user: authUser } };
      },
      onAuthStateChange: (
        handler: (event: string, session: { user: { id: string } } | null) => void,
      ) => {
        authHandlers.push(handler);
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                unsubscribes += 1;
                authHandlers = authHandlers.filter((h) => h !== handler);
              },
            },
          },
        };
      },
    },
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
// Rendered as its one interesting prop: whether this reader is offered the
// send. That is derived from the cached viewer id, so it is how a test sees
// whether the cache is still telling the truth.
jest.mock("./FollowUpPanel", () => ({
  FollowUpPanel: ({ canSend }: { canSend: boolean }) => (
    <div data-testid="follow-up" data-can-send={String(canSend)} />
  ),
}));

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
  authUser = { id: "host-1" };
  getUserCalls = 0;
  authHandlers = [];
  unsubscribes = 0;
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

describe("the viewer, cached but not stale", () => {
  /**
   * The viewer is read once rather than on every poll, which is only safe if
   * something notices when the session changes underneath it.
   *
   * It is not a cosmetic cache. `viewerId` decides `isHost`, `isHost` decides
   * `canSend`, and `canSend` decides whether the follow-up can be sent at all
   * — so a viewer id that outlives its own session hands the send control to
   * the wrong person, or takes it from the right one.
   */
  const WITH_FOLLOW_UP = {
    summary: "They agreed to wire on Friday.",
    key_points: [],
    action_items: [],
    analysis: { follow_up_draft: "Thanks all — wiring Friday." },
    full_transcript: "Ana: Friday.",
  };

  /** Act like another tab: hand the page's listeners a new session. */
  async function sessionBecomes(id: string | null) {
    await act(async () => {
      for (const handler of [...authHandlers]) {
        handler(id === null ? "SIGNED_OUT" : "SIGNED_IN", id === null ? null : { user: { id } });
      }
    });
    await settle();
  }

  it("asks the auth server once, not once per poll", async () => {
    // The whole point of the cache. Three polls, one question.
    db.report = null;
    render(<MeetingReportPage />);
    await settle();
    expect(getUserCalls).toBe(1);

    await poll();
    await poll();
    await poll();
    expect(getUserCalls).toBe(1);
  });

  it("takes the send control away when another tab signs in as someone else", async () => {
    db.report = { ...WITH_FOLLOW_UP };
    render(<MeetingReportPage />);
    await settle();
    // The host, so the control is offered.
    expect(screen.getByTestId("follow-up")).toHaveAttribute("data-can-send", "true");

    authUser = { id: "not-the-host" };
    await sessionBecomes("not-the-host");

    // Polling has already stopped by now — the report exists — so nothing else
    // would ever re-ask. Without the auth listener this still reads "true",
    // offering a send to somebody who is not the host.
    expect(getUserCalls).toBe(2);
    expect(screen.getByTestId("follow-up")).toHaveAttribute("data-can-send", "false");
  });

  it("gives it back when the host signs in", async () => {
    // The direction that loses a real capability rather than granting a false
    // one: the host sees their own report with the send control missing.
    db.meeting = { ...MEETING, host_id: "host-2" };
    authUser = { id: "guest-9" };
    db.report = { ...WITH_FOLLOW_UP };
    render(<MeetingReportPage />);
    await settle();
    expect(screen.getByTestId("follow-up")).toHaveAttribute("data-can-send", "false");

    authUser = { id: "host-2" };
    await sessionBecomes("host-2");

    expect(screen.getByTestId("follow-up")).toHaveAttribute("data-can-send", "true");
  });

  it("ignores a token refresh for the same account", async () => {
    // onAuthStateChange also fires on every silent refresh. Re-reading on those
    // would put the per-poll round trip straight back, which is the thing this
    // cache exists to remove — so the identity is compared, not the event.
    db.report = { ...WITH_FOLLOW_UP };
    render(<MeetingReportPage />);
    await settle();
    const readsAfter = reads.length;

    await sessionBecomes("host-1");
    await sessionBecomes("host-1");

    expect(getUserCalls).toBe(1);
    expect(reads.length).toBe(readsAfter);
  });

  it("re-asks whether the NEW account was there, instead of reusing the answer", async () => {
    /**
     * The sharper half, and it arrived from another PR rather than this one.
     *
     * Attendance is cached as "this meeting was attended" keyed by meeting id,
     * with no record of BY WHOM. So a stale entry does not merely mis-state who
     * is reading — it answers the attendance question on behalf of somebody who
     * was never in the meeting, short-circuiting the query that would have said
     * no. A non-attendee gets "Generating your report…" forever instead of
     * being told the report is not theirs, which is the exact defect the
     * attendance read was added to fix.
     */
    db.report = { ...WITH_FOLLOW_UP };
    db.attended = true;
    render(<MeetingReportPage />);
    await settle();
    expect(screen.getByTestId("follow-up")).toBeInTheDocument();

    // Somebody who was not in this meeting takes over the session.
    authUser = { id: "never-came" };
    db.attended = false;
    await sessionBecomes("never-came");

    // Asked again, and answered honestly.
    expect(screen.queryByTestId("follow-up")).toBeNull();
    expect(
      screen.getByText(/This report is limited to the people who were in the meeting/i),
    ).toBeInTheDocument();
  });

  it("stops listening when the page goes away", async () => {
    // A listener that outlives its component calls setState on an unmounted
    // one, and does it once per sign-in for the life of the tab.
    db.report = { ...WITH_FOLLOW_UP };
    const view = render(<MeetingReportPage />);
    await settle();
    expect(authHandlers.length).toBe(1);

    view.unmount();
    expect(unsubscribes).toBe(1);
    expect(authHandlers.length).toBe(0);
  });
});
