import {
  meetingHappenedAt,
  meetingMinutes,
  playableRecording,
  reportContent,
  reportOwedForMs,
  reportStillPending,
  type ReportMeeting,
  type ReportRecording,
  type ReportRow,
} from "./report-page";
import { REPORT_WAIT_LIMIT_MS } from "./attendance";
import { TRUNCATED_KEY } from "./report-analysis";

const meeting = (over: Partial<ReportMeeting> = {}): ReportMeeting => ({
  id: "m1",
  host_id: "host-1",
  title: "Dunbar follow-up",
  created_at: "2026-09-23T13:00:00.000Z",
  started_at: "2026-09-23T14:00:00.000Z",
  ended_at: "2026-09-23T14:40:00.000Z",
  scheduled_at: null,
  kind: "meeting",
  ...over,
});

const at = (iso: string) => Date.parse(iso);

describe("reportOwedForMs", () => {
  it("measures from the end of the meeting, not from the page opening", () => {
    // The whole reason this exists. On the client the clock started at mount, so
    // every reload gave a long-dead report another six minutes of "Generating".
    expect(reportOwedForMs(meeting(), at("2026-09-23T14:45:00.000Z"))).toBe(300_000);
  });

  it("gives the same answer a week later, because the meeting has not moved", () => {
    const owed = reportOwedForMs(meeting(), at("2026-09-30T14:40:00.000Z"));
    expect(owed).toBe(7 * 86_400_000);
  });

  it("dates a booked meeting to when it was BOOKED FOR, not when the row was made", () => {
    // The bug: created_at can be days before a meeting booked in advance, so a
    // meeting booked last week and not yet closed was declared "probably not
    // coming" the first time anybody opened its report.
    const booked = meeting({
      ended_at: null,
      started_at: null,
      scheduled_at: "2026-09-29T09:00:00.000Z",
      created_at: "2026-09-22T10:00:00.000Z",
    });
    expect(reportOwedForMs(booked, at("2026-09-29T09:05:00.000Z"))).toBe(300_000);
  });

  it("owes nothing for a meeting that has not happened yet", () => {
    const booked = meeting({
      ended_at: null,
      started_at: null,
      scheduled_at: "2026-10-05T09:00:00.000Z",
      created_at: "2026-09-22T10:00:00.000Z",
    });
    expect(reportOwedForMs(booked, at("2026-09-29T09:00:00.000Z"))).toBe(0);
  });

  it("prefers when it started over when it was booked", () => {
    // A meeting that ran late: the report is owed from the real start, not the
    // slot it was booked into.
    const ran = meeting({
      ended_at: null,
      started_at: "2026-09-29T09:30:00.000Z",
      scheduled_at: "2026-09-29T09:00:00.000Z",
    });
    expect(reportOwedForMs(ran, at("2026-09-29T09:35:00.000Z"))).toBe(300_000);
  });

  it("falls back to the row's creation when nobody ended the meeting", () => {
    // An abandoned room, or a one-way call that never had one. A report is still
    // owed; there is just no ended_at to owe it from.
    expect(
      reportOwedForMs(
        meeting({ ended_at: null, started_at: null, created_at: "2026-09-23T13:00:00.000Z" }),
        at("2026-09-23T13:02:00.000Z"),
      ),
    ).toBe(120_000);
  });

  it("is never negative on a skewed clock", () => {
    // Otherwise a report reads as overdue since before the meeting happened.
    expect(reportOwedForMs(meeting(), at("2026-09-23T14:00:00.000Z"))).toBe(0);
  });

  it("is zero rather than NaN on an unparseable date", () => {
    expect(reportOwedForMs(meeting({ ended_at: "not a date", created_at: "also not" }), 0)).toBe(0);
  });
});

describe("reportStillPending", () => {
  it("is patient right up to the limit", () => {
    const now = at("2026-09-23T14:40:00.000Z") + REPORT_WAIT_LIMIT_MS - 1;
    expect(reportStillPending(meeting(), now)).toBe(true);
  });

  it("gives up at the limit", () => {
    const now = at("2026-09-23T14:40:00.000Z") + REPORT_WAIT_LIMIT_MS;
    expect(reportStillPending(meeting(), now)).toBe(false);
  });

  it("has already given up on a meeting from last week", () => {
    // The case the old clock could not represent: somebody opening a week-old
    // report was told it was still being written.
    expect(reportStillPending(meeting(), at("2026-09-30T00:00:00.000Z"))).toBe(false);
  });
});

describe("playableRecording", () => {
  const rec = (over: Partial<ReportRecording> = {}): ReportRecording => ({
    id: "r1",
    status: "complete",
    duration_seconds: 600,
    size_bytes: 1024,
    started_by_name: "Ana",
    started_at: "2026-09-23T14:00:00.000Z",
    expires_at: "2026-12-23T14:00:00.000Z",
    deleted_at: null,
    mime_type: "video/webm",
    ...over,
  });

  it("is the first row when that row can be played", () => {
    expect(playableRecording([rec({ id: "a" }), rec({ id: "b" })])?.id).toBe("a");
  });

  it("skips a deleted recording rather than pointing the transcript at nothing", () => {
    // Keyed on index instead, the timestamps were offset against a recording
    // that renders no player at all.
    expect(playableRecording([rec({ id: "gone", deleted_at: "2026-09-24T00:00:00.000Z" }), rec({ id: "b" })])?.id)
      .toBe("b");
  });

  it("skips one that captured nothing", () => {
    expect(playableRecording([rec({ id: "empty", status: "abandoned" }), rec({ id: "b" })])?.id).toBe("b");
  });

  it("is null when nothing is playable", () => {
    expect(playableRecording([rec({ status: "abandoned" })])).toBeNull();
    expect(playableRecording([])).toBeNull();
  });

  it("still offers a recording that is mid-capture or failed partway", () => {
    // Both have something to play; only deleted and abandoned do not.
    expect(playableRecording([rec({ status: "recording" })])).not.toBeNull();
    expect(playableRecording([rec({ status: "failed" })])).not.toBeNull();
  });
});

describe("reportContent", () => {
  const row = (over: Partial<ReportRow> = {}): ReportRow => ({
    summary: "They agreed to wire on Friday.",
    key_points: ["Timing"],
    action_items: ["Send the wire"],
    analysis: null,
    full_transcript: "Ana: Friday.",
    ...over,
  });

  it("carries the plain fields through", () => {
    const c = reportContent(row());
    expect(c.summary).toBe("They agreed to wire on Friday.");
    expect(c.keyPoints).toEqual(["Timing"]);
    expect(c.actionItems).toEqual(["Send the wire"]);
    expect(c.transcript).toBe("Ana: Friday.");
  });

  it("coerces model output that is not a string, rather than handing React an object", () => {
    // Reports written before the route normalized can hold these, and rendering
    // one throws — replacing a finished report with an error page.
    const c = reportContent(
      row({
        key_points: [{ text: "Timing" } as unknown as string],
        analysis: { decisions: [{ text: "Wire Friday" } as unknown as string] },
      }),
    );
    expect(c.keyPoints.every((p) => typeof p === "string")).toBe(true);
    expect(c.decisions.every((d) => typeof d === "string")).toBe(true);
  });

  it("reads the analysis fields it renders", () => {
    const c = reportContent(
      row({
        analysis: {
          decisions: ["Wire Friday"],
          follow_up_draft: "Thanks all.",
          sentiment: "positive",
          next_meeting_suggestion: "Thursday at 10",
        },
      }),
    );
    expect(c.decisions).toEqual(["Wire Friday"]);
    expect(c.followUp).toBe("Thanks all.");
    expect(c.sentiment).toBe("positive");
    expect(c.nextMeeting).toBe("Thursday at 10");
  });

  it("treats a non-string sentiment or suggestion as absent", () => {
    // Rendered straight into the badge and the callout, so a stray object here
    // is another throw rather than a blank.
    const c = reportContent(
      row({ analysis: { sentiment: { v: "positive" }, next_meeting_suggestion: ["Thursday"] } }),
    );
    expect(c.sentiment).toBeNull();
    expect(c.nextMeeting).toBeNull();
  });

  it("is null for a follow-up draft that normalizes to nothing", () => {
    // An empty draft must not render a panel with a send button and no words.
    expect(reportContent(row({ analysis: { follow_up_draft: "   " } })).followUp).toBeNull();
  });

  it("reports truncation only when the flag is actually set", () => {
    expect(reportContent(row({ analysis: { [TRUNCATED_KEY]: true } })).truncated).toBe(true);
    expect(reportContent(row({ analysis: { [TRUNCATED_KEY]: "yes" } })).truncated).toBe(false);
    expect(reportContent(row()).truncated).toBe(false);
  });

  it("survives a null analysis, which is the common case", () => {
    const c = reportContent(row({ analysis: null }));
    expect(c.decisions).toEqual([]);
    expect(c.followUp).toBeNull();
    expect(c.truncated).toBe(false);
  });
});

describe("meetingMinutes", () => {
  it("is the wall clock between joining and ending", () => {
    expect(meetingMinutes(meeting())).toBe(40);
  });

  it("is null for a one-way call, which never had a room to join", () => {
    expect(meetingMinutes(meeting({ started_at: null }))).toBeNull();
  });

  it("is null for a meeting nobody ended", () => {
    expect(meetingMinutes(meeting({ ended_at: null }))).toBeNull();
  });
});

describe("meetingHappenedAt", () => {
  it("prefers when it started", () => {
    expect(meetingHappenedAt(meeting())).toBe("2026-09-23T14:00:00.000Z");
  });

  it("falls back to when it was booked, not when the row was made", () => {
    // The defect this ordering exists for: a report for Tuesday's board call
    // dated the Thursday before somebody booked it.
    expect(
      meetingHappenedAt(
        meeting({ started_at: null, scheduled_at: "2026-09-29T09:00:00.000Z" }),
      ),
    ).toBe("2026-09-29T09:00:00.000Z");
  });

  it("falls back to the row only when there is nothing better", () => {
    expect(meetingHappenedAt(meeting({ started_at: null, scheduled_at: null }))).toBe(
      "2026-09-23T13:00:00.000Z",
    );
  });
});
