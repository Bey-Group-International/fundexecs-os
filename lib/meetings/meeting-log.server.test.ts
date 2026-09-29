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

import { loadMeetingLog, searchMeetingLog } from "./meeting-log.server";

const MEETING = {
  id: "m1", room_code: "abc-def-gh", title: "LP Update", host_id: "host-1",
  created_at: "2026-03-01T10:00:00Z", started_at: null, ended_at: "2026-03-01T11:00:00Z",
  scheduled_at: "2026-03-01T10:00:00Z", duration_minutes: 60, status: "ended",
  attendees: [], is_draft: false,
};

/** The select string the meetings query was built with. */
let selectArg = "";
/** Clauses the meetings query was narrowed with, beyond the shared ones. */
let notCalls: unknown[][] = [];
/** Meetings the caller has an attendance row for, and the id lists asked about. */
let attended: string[] = [];
let attendanceAsked: string[][] = [];

function wire(reports: unknown) {
  from.mockImplementation((table: string) => {
    if (table === "live_meeting_participants") {
      const p: Record<string, unknown> = {
        select: () => p,
        eq: () => p,
        in: async (_col: string, ids: string[]) => {
          attendanceAsked.push(ids);
          return { data: attended.filter((id) => ids.includes(id)).map((meeting_id) => ({ meeting_id })) };
        },
      };
      return p;
    }
    const b: Record<string, unknown> = {
      select: (s: string) => { selectArg = s; return b; },
      eq: () => b,
      is: () => b,
      not: (...args: unknown[]) => { notCalls.push(args); return b; },
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
  notCalls = [];
  attended = [];
  attendanceAsked = [];
});

describe("attendance", () => {
  // It used to read every attendance row the user ever had, which past the
  // API's 1000-row cap was silently cut, so older meetings read as unattended.
  it("asks only about the meetings in the log, and marks the ones attended", async () => {
    attended = ["m1", "elsewhere"];
    const rows = await loadMeetingLog(wire([REPORT]), "org1", "someone-else");
    expect(attendanceAsked).toEqual([["m1"]]);
    expect(rows[0].attended).toBe(true);
  });
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

/**
 * Searching the log.
 *
 * The capability it did not have. It matched titles, summaries, decisions, action
 * items and attendee names with String.includes in the browser, so "what did we
 * agree with Dunbar in March" was answerable only if somebody had written
 * "Dunbar" in a title. The words were in the transcript, and the transcript was
 * never read.
 */
describe("searchMeetingLog", () => {
  /** A log row whose interesting words are ONLY in the transcript. */
  const TRANSCRIPT = [
    "Ana: The Dunbar valuation came in at forty.",
    "Priya: Forty is above where we modelled it.",
  ].join("\n");

  const report = (over: Record<string, unknown> = {}) => [{
    summary: "A routine update.",
    key_points: [],
    action_items: [],
    analysis: {},
    has_transcript: true,
    full_transcript: TRANSCRIPT,
    created_at: "2026-03-01T11:05:00Z",
    ...over,
  }];

  it("finds a meeting by a word said only in the transcript", async () => {
    // Nothing in the title, summary, decisions, action items or attendees says
    // "Dunbar". This is the whole point of the change.
    attended = ["m1"];
    const db = wire(report());

    const found = await searchMeetingLog(db, "org-1", "host-1", "dunbar");

    expect(found.rows).toHaveLength(1);
    expect(found.rows[0].hit?.reason).toBe("transcript");
    expect(found.rows[0].hit?.matches).toBe(1);
  });

  it("quotes the sentence the hit was in", async () => {
    // A row that says only "this matched" leaves the reader to open the report to
    // find out why.
    attended = ["m1"];
    const found = await searchMeetingLog(wire(report()), "org-1", "host-1", "modelled");
    const text = (found.rows[0].hit?.snippet?.parts ?? []).map((part) => part.value).join("");
    expect(text).toContain("above where we modelled");
    expect(found.rows[0].hit?.snippet?.speaker).toBe("Priya");
  });

  it("reads the transcript, which a list read never selects", async () => {
    attended = ["m1"];
    await searchMeetingLog(wire(report()), "org-1", "host-1", "dunbar");
    expect(selectArg).toContain("full_transcript");

    // And the list still does not, because it is up to 120,000 characters a row.
    await loadMeetingLog(wire(report()), "org-1", "host-1");
    expect(selectArg).not.toContain("full_transcript");
  });

  it("still matches on metadata, so the old searches keep working", async () => {
    attended = ["m1"];
    const found = await searchMeetingLog(
      wire(report({ full_transcript: "" })),
      "org-1",
      "host-1",
      "routine",
    );
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0].hit?.reason).toBe("metadata");
  });

  it("does not search a transcript the caller may not read", async () => {
    // A non-attendee's report comes back empty under RLS anyway. Searching a
    // transcript they are not entitled to would turn the search into a way of
    // reading it — a hit and a snippet are an excerpt.
    attended = [];
    const found = await searchMeetingLog(
      wire(report({ summary: "" })),
      "org-1",
      "someone-else",
      "dunbar",
    );
    expect(found.rows).toEqual([]);
  });

  it("returns nothing for a word nobody said or wrote", async () => {
    attended = ["m1"];
    const found = await searchMeetingLog(wire(report()), "org-1", "host-1", "tungsten");
    expect(found.rows).toEqual([]);
  });

  it("says how far it looked, so 'nothing' can be told from 'I stopped'", async () => {
    attended = ["m1"];
    const found = await searchMeetingLog(wire(report()), "org-1", "host-1", "tungsten");
    expect(found.scanned).toBe(1);
    expect(found.bounded).toBe(false);
  });

  it("admits the bound when the scan filled up", async () => {
    attended = ["m1"];
    // A scan of one, filled by one row: the search cannot claim it saw the rest.
    const found = await searchMeetingLog(wire(report()), "org-1", "host-1", "dunbar", 1);
    expect(found.bounded).toBe(true);
  });

  it("keeps drafts out, as the list does", async () => {
    // A search that surfaced a draft would be the only place they appear.
    attended = ["m1"];
    const db = wire(report());
    MEETING.is_draft = true;
    try {
      const found = await searchMeetingLog(db, "org-1", "host-1", "dunbar");
      expect(found.rows).toEqual([]);
    } finally {
      MEETING.is_draft = false;
    }
  });

  /** A database returning exactly these rows, for the counting tests below. */
  function wireRows(rows: Record<string, unknown>[]) {
    from.mockImplementation((table: string) => {
      if (table === "live_meeting_participants") {
        const p: Record<string, unknown> = {
          select: () => p, eq: () => p,
          in: async (_col: string, ids: string[]) => ({
            data: attended.filter((id) => ids.includes(id)).map((meeting_id) => ({ meeting_id })),
          }),
        };
        return p;
      }
      const b: Record<string, unknown> = {
        select: () => b, eq: () => b, is: () => b,
        not: (...args: unknown[]) => { notCalls.push(args); return b; },
        order: () => b, limit: () => b,
        then: (res: (v: unknown) => unknown) => res({ data: rows }),
      };
      return b;
    });
    return { from: (t: string) => from(t) } as unknown as Parameters<typeof searchMeetingLog>[0];
  }

  const soon = () => new Date(Date.now() + 72 * 3_600_000).toISOString();

  it("counts how many LOGGED meetings it looked at, not how many rows it read", async () => {
    // The sentence this feeds is "in the most recent N meetings". The scan takes
    // the most recent ROWS, and a row can be a meeting next Tuesday — never in
    // the log, so counting it overstates how far back the search reached, in the
    // one statement whose job is to admit how far back it reached.
    attended = ["past", "future"];
    const found = await searchMeetingLog(
      wireRows([
        { ...MEETING, id: "future", status: "waiting", ended_at: null, started_at: null, scheduled_at: soon(), live_meeting_reports: report() },
        { ...MEETING, id: "past", live_meeting_reports: report() },
      ]),
      "org-1",
      "host-1",
      "dunbar",
    );

    expect(found.rows.map((r) => r.meeting.id)).toEqual(["past"]);
    expect(found.scanned).toBe(1);
  });

  it("still reports the bound from how deep the query went", async () => {
    // `bounded` is about the QUERY stopping, which it did whether or not the
    // rows it came back with were loggable. Counting only the loggable ones here
    // would have a full scan of future bookings report that it saw everything.
    attended = ["future"];
    const found = await searchMeetingLog(
      wireRows([
        { ...MEETING, id: "future", status: "waiting", ended_at: null, started_at: null, scheduled_at: soon(), live_meeting_reports: report() },
      ]),
      "org-1",
      "host-1",
      "dunbar",
      1,
    );

    expect(found.scanned).toBe(0);
    expect(found.bounded).toBe(true);
  });

  it("does not return a meeting that has not happened yet", async () => {
    attended = ["future"];
    const found = await searchMeetingLog(
      wireRows([
        { ...MEETING, id: "future", status: "waiting", ended_at: null, started_at: null, scheduled_at: soon(), live_meeting_reports: report() },
      ]),
      "org-1",
      "host-1",
      "dunbar",
    );
    expect(found.rows).toEqual([]);
  });

  it("asks the database to leave drafts out, rather than paying to read them", async () => {
    // A draft that reaches the loop has already spent a row of the scan bound
    // and a read of a transcript up to 120,000 characters long, to be dropped.
    attended = ["m1"];
    await searchMeetingLog(wire(report()), "org-1", "host-1", "dunbar");
    expect(notCalls).toContainEqual(["is_draft", "is", true]);
  });

  it("asks about attendance only for the rows it read", async () => {
    // The batching rule the list already follows: reading every attendance row
    // the user ever had was silently cut at PostgREST's 1000-row cap.
    attended = ["m1"];
    await searchMeetingLog(wire(report()), "org-1", "host-1", "dunbar");
    expect(attendanceAsked).toEqual([["m1"]]);
  });
});
