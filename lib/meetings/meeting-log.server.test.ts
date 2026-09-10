/**
 * Loading the meeting log.
 *
 * The property under test is the one that breaks silently: the transcript flag.
 * The log never selects `full_transcript` — too large to pull for a list — so
 * whether "Regenerate from transcript" appears rests entirely on the generated
 * `has_transcript` boolean surviving the trip from the select string to the
 * mapped row. Drop it from either and the button disappears everywhere, with
 * nothing to show for it.
 */
const from = jest.fn();

import { loadMeetingLog } from "./meeting-log.server";

const MEETING = {
  id: "m1", room_code: "abc-def-gh", title: "LP Update", host_id: "host-1",
  created_at: "2026-03-01T10:00:00Z", started_at: null, ended_at: "2026-03-01T11:00:00Z",
  scheduled_at: "2026-03-01T10:00:00Z", duration_minutes: 60, status: "ended",
  attendees: [], is_draft: false,
};

/** The select string the meetings query was built with. */
let selectArg = "";

function wire(reports: unknown) {
  from.mockImplementation((table: string) => {
    if (table === "live_meeting_participants") {
      const p: Record<string, unknown> = { select: () => p, eq: async () => ({ data: [] }) };
      return p;
    }
    const b: Record<string, unknown> = {
      select: (s: string) => { selectArg = s; return b; },
      eq: () => b,
      is: () => b,
      order: () => b,
      limit: () => b,
      then: (res: (v: unknown) => unknown) =>
        res({ data: [{ ...MEETING, live_meeting_reports: reports }] }),
    };
    return b;
  });
  return { from: (t: string) => from(t) } as unknown as Parameters<typeof loadMeetingLog>[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  selectArg = "";
});

const REPORT = { summary: "s", key_points: [], action_items: [], analysis: {} };

describe("the transcript flag", () => {
  it("asks the database for it", async () => {
    await loadMeetingLog(wire([{ ...REPORT, has_transcript: true }]), "org1", "host-1");
    expect(selectArg).toContain("has_transcript");
    // ...and still does not ask for the transcript itself, which is the whole
    // reason the generated column exists.
    expect(selectArg).not.toContain("full_transcript");
  });

  it("carries it through to the row", async () => {
    const rows = await loadMeetingLog(wire([{ ...REPORT, has_transcript: true }]), "org1", "host-1");
    expect(rows[0].report?.has_transcript).toBe(true);
  });

  it("is false, not undefined, when the column does not come back", async () => {
    // A row read before the column existed. Absence must not read as presence:
    // the log would offer a button that answers 409.
    const rows = await loadMeetingLog(wire([REPORT]), "org1", "host-1");
    expect(rows[0].report?.has_transcript).toBe(false);
  });

  it("is false when the report says so", async () => {
    const rows = await loadMeetingLog(wire([{ ...REPORT, has_transcript: false }]), "org1", "host-1");
    expect(rows[0].report?.has_transcript).toBe(false);
  });
});

describe("a meeting with no report", () => {
  it("is still in the log", async () => {
    const rows = await loadMeetingLog(wire([]), "org1", "host-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].report).toBeNull();
    expect(rows[0].isHost).toBe(true);
  });
});
