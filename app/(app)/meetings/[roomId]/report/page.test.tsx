/**
 * The report page's states, now decided on the server.
 *
 * This file used to mount a client component and let it fetch. The page is a
 * server component, so each case awaits it and renders what it returned — which
 * is also the honest shape of the test, because that markup is now what a reader
 * actually receives.
 *
 * WHAT WAS PORTED AND WHAT WAS NOT, said out loud, because deleting tests is how
 * a refactor passes without being correct:
 *
 *   Ported unchanged in substance — every state and every piece of copy: an
 *   unsummarised row rendering rather than spinning, the two different reasons a
 *   summary can be missing, a non-attendee being told, a missing meeting, a
 *   stalled report, the consent block.
 *
 *   Ported as structure — "stops polling rather than asking forever" and "the
 *   transcript read is not repeated on every poll". There is no client poll left
 *   to repeat anything, so the assertion became: a finished report mounts no
 *   poller at all. Same guarantee, one level up.
 *
 *   NOT ported, and gone on purpose — six cases about a cached viewer going
 *   stale when another tab switched accounts. They tested `viewerRef` and
 *   `attendedRef`, a client-side cache that existed only because the page asked
 *   the auth server on every five-second poll. The server reads the session from
 *   the request's own cookies, so there is no cache to go stale and nothing to
 *   invalidate. That class of bug is gone by construction rather than by a fix,
 *   which is the only reason it is acceptable for its tests to go with it.
 */

import React from "react";
import { render, screen } from "@testing-library/react";

/** Every table read, so a test can count them and see what was asked for. */
let reads: string[] = [];

/** What the fake database answers with. */
const db: {
  meeting: Record<string, unknown> | null;
  report: Record<string, unknown> | null;
  attended: boolean;
  recordings: Array<Record<string, unknown>>;
  chat: Array<Record<string, unknown>>;
  transcript: Array<Record<string, unknown>>;
  viewer: { id: string; email?: string } | null;
} = {
  meeting: null,
  report: null,
  attended: true,
  recordings: [],
  chat: [],
  transcript: [],
  viewer: { id: "host-1", email: "host@fundexecs.com" },
};

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.viewer } }) },
    from: (table: string) => {
      reads.push(table);
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        range: async () => ({ data: db.transcript, error: null }),
        maybeSingle: async () => {
          if (table === "live_meetings") return { data: db.meeting };
          if (table === "live_meeting_reports") return { data: db.report };
          if (table === "live_meeting_participants") {
            return { data: db.attended ? { meeting_id: "m1" } : null };
          }
          return { data: null };
        },
        // Recordings and chat are awaited as the builder itself.
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({
            data: table === "live_meeting_recordings" ? db.recordings : db.chat,
          }).then(resolve),
      };
      return chain;
    },
  }),
}));

// The interactive islands do their own thing and none of it is what this file is
// about. Each is rendered as a marker so the document can be asserted around it.
jest.mock("./ReportMedia", () => ({
  ReportMedia: ({ transcript }: { transcript: string | null }) => (
    <div data-testid="report-media" data-has-transcript={String(Boolean(transcript))} />
  ),
}));
jest.mock("./ChatPanel", () => ({
  ChatPanel: ({ messages }: { messages: unknown[] }) => (
    <div data-testid="chat-panel" data-count={String(messages.length)} />
  ),
}));
jest.mock("./ExportMenu", () => ({ ExportMenu: () => null }));
// The inbox history does its own reads and streams in behind Suspense. Rendered
// as a marker that reports exactly what the page handed it, because the three
// props it takes are used by nothing else on the page — so dropping one would
// break only this sidebar, only for meetings that have correspondence, and
// nothing else in this file would notice.
jest.mock("./AttendeeHistory", () => ({
  AttendeeHistoryPanel: ({
    meetingId,
    organizationId,
    invited,
    viewerEmail,
  }: {
    meetingId: string;
    organizationId: string | null;
    invited: unknown;
    viewerEmail: string | null;
  }) => (
    <div
      data-testid="attendee-history"
      data-meeting={meetingId}
      data-org={String(organizationId)}
      data-invited={JSON.stringify(invited)}
      data-viewer={String(viewerEmail)}
    />
  ),
}));
// The sidebar's people, follow-up status and tasks come from a loader of their
// own, tested on its own. Faked here so "the reads" below still measures the
// report's own pass, and so a test can hand the page a sidebar to render.
const side = {
  participants: [] as Array<Record<string, unknown>>,
  hostName: null as string | null,
  followUp: { kind: "not_sent" } as Record<string, unknown>,
  tasks: [] as Array<Record<string, unknown>>,
};
jest.mock("@/lib/meetings/report-side.server", () => ({
  loadReportSide: async () => side,
}));
jest.mock("./ReportRevisions", () => ({
  ReportRevisions: ({ isHost }: { isHost: boolean }) => (
    <div data-testid="report-revisions" data-host={String(isHost)} />
  ),
}));
jest.mock("./FollowUpPanel", () => ({
  FollowUpStatusChip: () => null,
  FollowUpPanel: ({ canSend }: { canSend: boolean }) => (
    <div data-testid="follow-up" data-can-send={String(canSend)} />
  ),
}));
// The only remaining client island with a timer. Rendered as a marker so a test
// can assert whether the page is still waiting on anything.
jest.mock("./ReportWaiting", () => ({
  ReportWaiting: ({ stopAfterMs }: { stopAfterMs: number }) => (
    <div data-testid="waiting" data-stop-after={String(stopAfterMs)} />
  ),
}));

import MeetingReportPage from "./page";
import { REPORT_WAIT_LIMIT_MS } from "@/lib/meetings/attendance";

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
  organization_id: "org-1",
  attendees: [{ name: "Ana Diaz", email: "ana@acme.com" }],
};

/** Just after the meeting ended, so a missing report is still plausibly coming. */
const JUST_AFTER = Date.parse("2026-09-23T14:41:00.000Z");

/** Await the server component and render what it returned. */
async function renderPage() {
  const ui = await MeetingReportPage({ params: Promise.resolve({ roomId: "abc-def-gh" }) });
  return render(ui);
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(JUST_AFTER);
  reads = [];
  db.meeting = { ...MEETING };
  db.report = null;
  db.attended = true;
  db.recordings = [];
  db.chat = [];
  db.transcript = [];
  db.viewer = { id: "host-1", email: "host@fundexecs.com" };
});

afterEach(() => {
  jest.useRealTimers();
});

describe("a report that exists without a summary", () => {
  const unsummarised = { summary: "", key_points: [], action_items: [], analysis: {}, full_transcript: "" };

  it("is rendered, not hidden behind a spinner", async () => {
    db.report = { ...unsummarised };
    await renderPage();

    expect(screen.getByText("Dunbar follow-up")).toBeInTheDocument();
    expect(screen.getByText(/No summary was written/i)).toBeInTheDocument();
    expect(screen.queryByText(/Generating your report/i)).toBeNull();
  });

  it("still shows the recording", async () => {
    // The thing worth having when there is no summary, and the thing the spinner
    // used to cover up.
    db.report = { ...unsummarised };
    db.recordings = [{ id: "r1", status: "complete", deleted_at: null, started_at: "2026-09-23T14:00:00.000Z" }];
    await renderPage();
    expect(screen.getByTestId("report-media")).toBeInTheDocument();
  });

  it("mounts no poller, rather than asking forever", async () => {
    // Was "stops polling". There is no client poll left to stop: a finished
    // report ships as markup with nothing watching it.
    db.report = { ...unsummarised };
    await renderPage();
    expect(screen.queryByTestId("waiting")).toBeNull();
  });

  it("blames the analysis, not the microphone, when there are words", async () => {
    // A one-way call whose MODEL failed has a real transcript, so the copy must
    // not claim nothing was transcribed above the words themselves.
    db.meeting = { ...MEETING, kind: "one_way" };
    db.report = { ...unsummarised, full_transcript: "Priya: we agreed on Friday." };
    await renderPage();

    expect(screen.getByText(/analysis could not be completed/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing was transcribed/i)).toBeNull();
  });

  it("says nothing was transcribed only when nothing was", async () => {
    db.meeting = { ...MEETING, kind: "one_way" };
    db.report = { ...unsummarised, full_transcript: "" };
    await renderPage();
    expect(screen.getByText(/Nothing was transcribed/i)).toBeInTheDocument();
  });
});

describe("a report that has not been written", () => {
  it("waits, and leaves something behind to keep asking", async () => {
    db.report = null;
    await renderPage();

    expect(screen.getByText(/Generating your report/i)).toBeInTheDocument();
    expect(screen.getByTestId("waiting")).toBeInTheDocument();
  });

  it("gives the poller the time that is LEFT, not a fresh allowance", async () => {
    // The rule that changed crossing to the server. The meeting ended a minute
    // ago, so there is a minute less patience — on the client every reload
    // started the six minutes again, so a long-dead report was always still
    // "arriving".
    db.report = null;
    await renderPage();

    const left = Number(screen.getByTestId("waiting").getAttribute("data-stop-after"));
    expect(left).toBe(REPORT_WAIT_LIMIT_MS - 60_000);
  });

  it("renders the report once it exists", async () => {
    db.report = {
      summary: "They agreed to wire on Friday.",
      key_points: ["Timing"],
      action_items: [],
      analysis: {},
      full_transcript: "Ana: Friday.",
    };
    await renderPage();

    expect(screen.getByText("They agreed to wire on Friday.")).toBeInTheDocument();
    expect(screen.queryByTestId("waiting")).toBeNull();
  });
});

describe("the reads", () => {
  it("asks for everything once, in one render", async () => {
    // Was "the timed transcript read is not repeated on every poll". It cannot
    // be: there is one server pass and nothing on the client re-reads. Asserted
    // as each table appearing exactly once.
    db.report = { summary: "Done.", key_points: [], action_items: [], analysis: {}, full_transcript: "x" };
    await renderPage();

    const counts = reads.reduce<Record<string, number>>((acc, t) => {
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({
      live_meetings: 1,
      live_meeting_reports: 1,
      live_meeting_participants: 1,
      live_meeting_recordings: 1,
      live_meeting_chat: 1,
      live_meeting_transcripts: 1,
    });
  });

  it("hands the transcript and the chat down as data, not as work to do", async () => {
    // The two panels that used to fetch on mount, so neither could start until
    // the page had already rendered.
    db.report = { summary: "Done.", key_points: [], action_items: [], analysis: {}, full_transcript: "Ana: Friday." };
    db.chat = [{ id: "c1", author_id: "u1", author_name: "Ana", body: "hi", ts: "2026-09-23T14:05:00.000Z" }];
    await renderPage();

    expect(screen.getByTestId("report-media")).toHaveAttribute("data-has-transcript", "true");
    expect(screen.getByTestId("chat-panel")).toHaveAttribute("data-count", "1");
  });
});

describe("who may read it", () => {
  it("says so plainly to someone who was not there", async () => {
    // The defect this replaced: RLS hides the report from a non-attendee, which
    // looks exactly like a report still being written.
    db.meeting = { ...MEETING, host_id: "someone-else" };
    db.attended = false;
    db.report = null;
    await renderPage();

    expect(screen.getByText(/This report is limited to the people who were in the meeting/i))
      .toBeInTheDocument();
    expect(screen.queryByText(/Generating your report/i)).toBeNull();
    expect(screen.queryByTestId("waiting")).toBeNull();
  });

  it("reports a meeting that is not there", async () => {
    db.meeting = null;
    await renderPage();
    expect(screen.getByText(/Meeting not found/i)).toBeInTheDocument();
  });

  it("offers the follow-up send to the host", async () => {
    db.report = {
      summary: "Done.",
      key_points: [],
      action_items: [],
      analysis: { follow_up_draft: "Thanks all." },
      full_transcript: "x",
    };
    await renderPage();
    expect(screen.getByTestId("follow-up")).toHaveAttribute("data-can-send", "true");
  });

  it("withholds it from an attendee who is not the host", async () => {
    db.meeting = { ...MEETING, host_id: "someone-else" };
    db.report = {
      summary: "Done.",
      key_points: [],
      action_items: [],
      analysis: { follow_up_draft: "Thanks all." },
      full_transcript: "x",
    };
    await renderPage();
    expect(screen.getByTestId("follow-up")).toHaveAttribute("data-can-send", "false");
  });
});

describe("a report that is never coming", () => {
  it("gives up and explains, rather than spinning for the life of the tab", async () => {
    // Decided from the MEETING's age now, so this needs no simulated waiting —
    // and, unlike the client version, it is already decided for the first person
    // to open the page rather than six minutes after they do.
    db.report = null;
    jest.setSystemTime(Date.parse("2026-09-23T14:40:00.000Z") + REPORT_WAIT_LIMIT_MS);
    await renderPage();

    expect(screen.getByText(/has no report yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("waiting")).toBeNull();
  });

  it("has already given up on a meeting from last week", async () => {
    // The case the old clock could not represent at all.
    db.report = null;
    jest.setSystemTime(Date.parse("2026-09-30T00:00:00.000Z"));
    await renderPage();
    expect(screen.getByText(/has no report yet/i)).toBeInTheDocument();
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
    await renderPage();

    // Stored so somebody can answer "should this have been recorded?" — and
    // until now shown on every page except the one they would ask it on.
    expect(screen.getByText(/Consent recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/I am recording this call/i)).toBeInTheDocument();
  });

  it("shows no consent block for an ordinary meeting", async () => {
    db.report = { summary: "A meeting.", key_points: [], action_items: [], analysis: {}, full_transcript: "x" };
    await renderPage();
    expect(screen.queryByText(/Consent recorded/i)).toBeNull();
  });

  it("falls back to the recording's length when the call had no room to join", async () => {
    // A one-way call has no started_at, so the wall clock is null and the
    // recording's own duration is the only length the header can show.
    db.meeting = { ...MEETING, kind: "one_way", started_at: null, ended_at: null };
    db.report = { summary: "A call.", key_points: [], action_items: [], analysis: {}, full_transcript: "x" };
    db.recordings = [
      {
        id: "r1",
        status: "complete",
        deleted_at: null,
        started_at: "2026-09-23T14:00:00.000Z",
        duration_seconds: 754,
      },
    ];
    await renderPage();

    expect(screen.getByText(/12:34/)).toBeInTheDocument();
  });
});

/**
 * The seam between the report and the inbox: one JSX element and four props.
 *
 * Neither the pure rule's tests nor the loader's tests can see it. That is the
 * exact shape of the gap that let a correction UI ship with its read-path flag
 * inverted and 7,888 tests pass — a rule tested, and the single line wiring it in
 * not.
 */
describe("the inbox history beside the report", () => {
  const ready = {
    summary: "They agreed to wire on Friday.",
    key_points: [],
    action_items: [],
    analysis: {},
    full_transcript: "Ana: Friday.",
  };

  it("is handed the meeting, its organisation, its invite list and the reader", async () => {
    db.report = { ...ready };
    await renderPage();

    const panel = screen.getByTestId("attendee-history");
    expect(panel).toHaveAttribute("data-meeting", "m1");
    expect(panel).toHaveAttribute("data-org", "org-1");
    expect(panel).toHaveAttribute(
      "data-invited",
      JSON.stringify([{ name: "Ana Diaz", email: "ana@acme.com" }]),
    );
    expect(panel).toHaveAttribute("data-viewer", "host@fundexecs.com");
  });

  /**
   * A reader who was not in the meeting gets the page that says so, and the
   * history must not be one of the things that still renders on it. Asserted on
   * the panel's absence rather than on its props, because the loader clearing the
   * organisation and the page not rendering the panel are two separate
   * protections and this is the one the page owns.
   */
  it("is not rendered for somebody who was not in the meeting", async () => {
    db.viewer = { id: "outsider", email: "outsider@elsewhere.com" };
    db.attended = false;
    db.report = { ...ready };
    await renderPage();

    expect(screen.getByText(/limited to the people who were in the meeting/i)).toBeInTheDocument();
    expect(screen.queryByTestId("attendee-history")).toBeNull();
  });

  // Nor on any of the pages that are not the report: there is nothing to be
  // beside yet, and the reads would be spent on a document that has not arrived.
  it("is not rendered while the report is still being written", async () => {
    db.report = null;
    await renderPage();
    expect(screen.getByText(/Generating your report/i)).toBeInTheDocument();
    expect(screen.queryByTestId("attendee-history")).toBeNull();
  });

  // A meeting with no organisation still renders the panel; the loader is what
  // decides there is nothing to read. Asserted so the null is seen to travel,
  // rather than the page quietly deciding for it and the two disagreeing.
  it("passes a missing organisation through rather than hiding the panel", async () => {
    db.meeting = { ...MEETING, organization_id: null };
    db.report = { ...ready };
    await renderPage();
    expect(screen.getByTestId("attendee-history")).toHaveAttribute("data-org", "null");
  });
});

describe("the sidebar and the meeting at a glance", () => {
  afterEach(() => {
    side.participants = [];
    side.tasks = [];
  });

  it("says who the meeting was between, and in what role", async () => {
    db.report = { summary: "Done.", key_points: [], action_items: [], analysis: {}, full_transcript: "x" };
    side.participants = [
      { name: "Alex Rivera", email: "host@fundexecs.com", role: "host", attended: true, receivesFollowUp: false },
      { name: "Ana Diaz", email: "ana@acme.com", role: "invitee", attended: false, receivesFollowUp: true },
    ];
    await renderPage();

    expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
    expect(screen.getByText("Host")).toBeInTheDocument();
    expect(screen.getByText(/Invitee · didn’t join/)).toBeInTheDocument();
  });

  it("shows the action items as the tasks they became", async () => {
    db.report = {
      summary: "Done.",
      key_points: [],
      action_items: ["Ana: Send the deck", "Book a call"],
      analysis: { decisions: ["Proceed"] },
      full_transcript: "x",
    };
    side.tasks = [
      { id: "t1", title: "Send the deck", status: "completed", dueAt: null, assignedTo: "u1", assigneeName: "Ana Diaz", actionItem: "Ana: Send the deck" },
    ];
    await renderPage();

    expect(screen.getByLabelText("Send the deck")).toBeChecked();
    expect(screen.getByText("1/2 done")).toBeInTheDocument();
  });

  it("says when a meeting captured no action items, rather than leaving a gap", async () => {
    db.report = { summary: "Done.", key_points: ["A"], action_items: [], analysis: {}, full_transcript: "x" };
    await renderPage();
    expect(screen.getByText(/No action items were captured/)).toBeInTheDocument();
    expect(screen.getByText(/No decisions were recorded/)).toBeInTheDocument();
  });
});
