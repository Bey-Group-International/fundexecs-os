import {
  UNTITLED_MEETING,
  attendeeNames,
  belongsInLog,
  groupLogsByMonth,
  logEntrySubtitle,
  loggedMeeting,
  meetingLogDetail,
  meetingLogDuration,
  meetingOccurredAt,
  sortLogEntries,
  toLogEntry,
  type MeetingLogSource,
} from "@/lib/meetings/meeting-log";

const meeting: MeetingLogSource = {
  id: "m1",
  room_code: "abc-123",
  title: "Q3 LP Update",
  created_at: "2026-09-01T09:00:00.000Z",
  started_at: "2026-09-07T14:00:00.000Z",
  ended_at: "2026-09-07T14:47:00.000Z",
  scheduled_at: "2026-09-07T14:00:00.000Z",
  duration_minutes: 60,
  status: "ended",
  attendees: [{ name: "Alina Reyes", email: "alina@example.com" }, { name: "Ray" }],
};

const report = {
  summary: "Walked the LPs through Q3 marks.",
  key_points: ["NAV up 4.2%", "Two new commitments"],
  action_items: ["Send the deck to Alina"],
  analysis: { decisions: ["Hold the close until October"], sentiment: "positive" },
};

describe("meetingOccurredAt", () => {
  it("prefers when it ended", () => {
    expect(meetingOccurredAt(meeting)).toBe(meeting.ended_at);
  });

  // A meeting nobody joined still belongs in the log at the hour it was meant
  // to happen, not when somebody drafted it three weeks earlier.
  it("falls back through started, scheduled, then created", () => {
    expect(meetingOccurredAt({ ...meeting, ended_at: null })).toBe(meeting.started_at);
    expect(meetingOccurredAt({ ...meeting, ended_at: null, started_at: null })).toBe(meeting.scheduled_at);
    expect(meetingOccurredAt({ ...meeting, ended_at: null, started_at: null, scheduled_at: null }))
      .toBe(meeting.created_at);
  });
});

describe("meetingLogDuration", () => {
  it("prefers what actually happened over what was booked", () => {
    expect(meetingLogDuration(meeting)).toBe(47);
  });

  it("falls back to the booked length when it never ran", () => {
    expect(meetingLogDuration({ ...meeting, started_at: null, ended_at: null })).toBe(60);
  });

  it("is null when neither is usable", () => {
    expect(meetingLogDuration({
      ...meeting, started_at: null, ended_at: null, duration_minutes: null,
    })).toBeNull();
    expect(meetingLogDuration({
      ...meeting, started_at: null, ended_at: null, duration_minutes: 0,
    })).toBeNull();
  });

  it("ignores timestamps that run backwards", () => {
    expect(meetingLogDuration({ ...meeting, started_at: meeting.ended_at, ended_at: meeting.started_at }))
      .toBe(60);
  });
});

describe("attendeeNames", () => {
  it("takes the name, or the address when there is no name", () => {
    expect(attendeeNames([{ name: "Alina" }, { email: "ray@example.com" }]))
      .toEqual(["Alina", "ray@example.com"]);
  });

  it("accepts bare strings, which older rows hold", () => {
    expect(attendeeNames(["Alina", " Ray "])).toEqual(["Alina", "Ray"]);
  });

  // attendees is a jsonb column written by several paths, including a public
  // booking page.
  it("survives anything that is not a list of people", () => {
    expect(attendeeNames(null)).toEqual([]);
    expect(attendeeNames("Alina")).toEqual([]);
    expect(attendeeNames([null, {}, { name: "   " }, 7])).toEqual([]);
  });
});

describe("toLogEntry", () => {
  it("carries the report through", () => {
    const entry = toLogEntry(meeting, report);
    expect(entry.summary).toBe("Walked the LPs through Q3 marks.");
    expect(entry.keyPoints).toEqual(["NAV up 4.2%", "Two new commitments"]);
    expect(entry.decisions).toEqual(["Hold the close until October"]);
    expect(entry.actionItems).toEqual(["Send the deck to Alina"]);
    expect(entry.sentiment).toBe("positive");
    expect(entry.hasReport).toBe(true);
  });

  it("is still an entry when no report was ever generated", () => {
    const entry = toLogEntry(meeting, null);
    expect(entry.hasReport).toBe(false);
    expect(entry.summary).toBe("");
    expect(entry.keyPoints).toEqual([]);
    expect(entry.title).toBe("Q3 LP Update");
  });

  it("names an untitled meeting", () => {
    expect(toLogEntry({ ...meeting, title: null }, report).title).toBe(UNTITLED_MEETING);
    expect(toLogEntry({ ...meeting, title: "  " }, report).title).toBe(UNTITLED_MEETING);
  });

  // The same coercion the report page and the export use — older reports hold
  // objects where this expects strings.
  it("coerces model output that arrives as objects", () => {
    const entry = toLogEntry(meeting, { ...report, key_points: [{ text: "NAV up 4.2%" }] });
    expect(entry.keyPoints).toEqual(["NAV up 4.2%"]);
  });

  it("treats a whitespace-only summary as no report", () => {
    expect(toLogEntry(meeting, { ...report, summary: "   " }).hasReport).toBe(false);
  });

  // canRegenerate answers a different question from hasReport: whether there is
  // a TRANSCRIPT to re-read, not whether there is a SUMMARY to show.
  describe("canRegenerate", () => {
    it("is true for a report whose analysis failed, which has no summary at all", () => {
      // The end-of-meeting route writes exactly this row when the model fails:
      // the transcript kept, the summary empty. Gating the regenerate action on
      // hasReport hid the button from the one row that most needed it.
      const entry = toLogEntry(meeting, { ...report, summary: "", has_transcript: true });
      expect(entry.hasReport).toBe(false);
      expect(entry.canRegenerate).toBe(true);
    });

    it("is false for a report with a summary but no transcript behind it", () => {
      const entry = toLogEntry(meeting, { ...report, has_transcript: false });
      expect(entry.hasReport).toBe(true);
      // Offering to re-read a transcript that is not there would be a button
      // that answers 409.
      expect(entry.canRegenerate).toBe(false);
    });

    it("is false when there is no report row at all", () => {
      expect(toLogEntry(meeting, null).canRegenerate).toBe(false);
    });

    it("is false when the column is missing or null, rather than assuming", () => {
      // Rows read through a path that did not select the column, and rows from
      // before the column existed. Absence is not evidence of a transcript.
      expect(toLogEntry(meeting, { ...report, has_transcript: undefined }).canRegenerate).toBe(false);
      expect(toLogEntry(meeting, { ...report, has_transcript: null }).canRegenerate).toBe(false);
    });
  });
});

// ── The split between a row and its detail ─────────────────────────────────
//
// The log used to ship every entry's prose so the browser could filter it. The
// filtering moved to the server (see session-archive.ts and
// meeting-log.server.ts) and the prose moved with it, which leaves the list
// shipping these two shapes: one per row, one per OPEN row.

describe("loggedMeeting", () => {
  const entry = toLogEntry(meeting, report);

  it("carries no prose at all, which is the point", () => {
    const row = loggedMeeting(entry);
    // Asserted over the serialised row rather than field by field: the payload
    // is what this exists to shrink, and a field added later that happens to
    // hold a sentence would pass an assertion written as a list of keys.
    const json = JSON.stringify(row);
    expect(json).not.toContain("Walked the LPs through");
    expect(json).not.toContain("NAV up 4.2%");
    expect(json).not.toContain("Hold the close");
    expect(json).not.toContain("Send the deck");
    expect(json).not.toContain("Alina");
  });

  it("keeps what a collapsed row actually draws", () => {
    const row = loggedMeeting(entry);
    expect(row.id).toBe("m1");
    expect(row.roomCode).toBe("abc-123");
    expect(row.title).toBe("Q3 LP Update");
    expect(row.occurredAt).toBe(meeting.ended_at);
    expect(row.durationMinutes).toBe(47);
    expect(row.attendeeCount).toBe(2);
    expect(row.counts).toEqual({ keyPoints: 2, decisions: 1, actionItems: 1 });
    expect(row.hasReport).toBe(true);
  });

  it("keeps the flags the row's own actions are gated on", () => {
    // Dropping either of these would be a payload saving that costs the
    // regenerate button and the attendees-only explanation.
    const row = loggedMeeting(toLogEntry(meeting, { ...report, has_transcript: true }, false, true));
    expect(row.canRegenerate).toBe(true);
    expect(row.attended).toBe(false);
    expect(row.isHost).toBe(true);
  });
});

describe("meetingLogDetail", () => {
  it("is the prose the row left behind", () => {
    const detail = meetingLogDetail(toLogEntry(meeting, report));
    expect(detail.summary).toBe("Walked the LPs through Q3 marks.");
    expect(detail.keyPoints).toEqual(["NAV up 4.2%", "Two new commitments"]);
    expect(detail.decisions).toEqual(["Hold the close until October"]);
    expect(detail.actionItems).toEqual(["Send the deck to Alina"]);
    expect(detail.attendeeNames).toEqual(["Alina Reyes", "Ray"]);
  });

  it("carries its own id, so a slow response cannot fill in another row", () => {
    // The reader can open a second meeting while the first detail is in flight.
    expect(meetingLogDetail(toLogEntry(meeting, report)).id).toBe("m1");
  });

  it("together with the row, loses nothing the entry held", () => {
    // The split is a move, not a cut: every field of an entry is in one half or
    // the other. Without this, dropping a field from both halves reads as a
    // payload win.
    const entry = toLogEntry(meeting, report);
    const covered = new Set([
      ...Object.keys(loggedMeeting(entry)),
      ...Object.keys(meetingLogDetail(entry)),
      // The counts stand in for the lists they count.
      "keyPoints", "decisions", "actionItems", "attendeeNames",
    ]);
    for (const key of Object.keys(entry)) expect(covered.has(key)).toBe(true);
  });
});

describe("belongsInLog", () => {
  const now = Date.parse("2026-09-20T12:00:00.000Z");

  it("keeps a meeting that ended", () => {
    expect(belongsInLog({ ...meeting, is_draft: false }, now)).toBe(true);
  });

  it("drops a meeting still to come", () => {
    // It has no record to hold yet, and listing it under "Logs" promises one.
    expect(belongsInLog({
      ...meeting,
      status: "waiting",
      ended_at: null,
      started_at: null,
      scheduled_at: "2026-09-28T09:00:00.000Z",
    }, now)).toBe(false);
  });

  it("drops a draft", () => {
    expect(belongsInLog({ ...meeting, is_draft: true }, now)).toBe(false);
  });

  it("is the same rule the search route and the page both apply", () => {
    // Stated as a test because the failure is invisible from either side alone:
    // a search hit the list does not show is the only place that meeting
    // appears, and it looks like a search bug rather than two rules.
    const future = {
      ...meeting,
      status: "waiting",
      ended_at: null,
      started_at: null,
      scheduled_at: "2026-09-28T09:00:00.000Z",
    };
    expect(belongsInLog(future, now)).toBe(false);
    expect(belongsInLog({ ...future, status: "ended" }, now)).toBe(true);
  });
});

describe("sortLogEntries", () => {
  it("puts the newest first", () => {
    const older = toLogEntry({ ...meeting, id: "m0", ended_at: "2026-08-01T10:00:00.000Z" }, report);
    const newer = toLogEntry(meeting, report);
    expect(sortLogEntries([older, newer]).map((e) => e.id)).toEqual(["m1", "m0"]);
  });

  it("does not mutate what it was given", () => {
    const entries = [
      toLogEntry({ ...meeting, id: "a", ended_at: "2026-08-01T10:00:00.000Z" }, report),
      toLogEntry({ ...meeting, id: "b" }, report),
    ];
    sortLogEntries(entries);
    expect(entries.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("groupLogsByMonth", () => {
  it("splits by the month a meeting happened in, newest group first", () => {
    const groups = groupLogsByMonth([
      toLogEntry({ ...meeting, id: "aug", ended_at: "2026-08-14T10:00:00.000Z" }, report),
      toLogEntry({ ...meeting, id: "sep", ended_at: "2026-09-07T10:00:00.000Z" }, report),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["September 2026", "August 2026"]);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["sep"]);
  });

  it("keeps a month's meetings together and newest first inside it", () => {
    const groups = groupLogsByMonth([
      toLogEntry({ ...meeting, id: "early", ended_at: "2026-09-02T10:00:00.000Z" }, report),
      toLogEntry({ ...meeting, id: "late", ended_at: "2026-09-20T10:00:00.000Z" }, report),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["late", "early"]);
  });

  it("does not drop an entry whose date is unusable", () => {
    const groups = groupLogsByMonth([
      toLogEntry({
        ...meeting, id: "bad", ended_at: "not a date", started_at: null,
        scheduled_at: null, created_at: "not a date",
      }, report),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Undated");
  });

  it("is empty for no meetings, rather than one empty group", () => {
    expect(groupLogsByMonth([])).toEqual([]);
  });
});

describe("logEntrySubtitle", () => {
  it("counts what the meeting produced", () => {
    expect(logEntrySubtitle(loggedMeeting(toLogEntry(meeting, report))))
      .toBe("2 key points · 1 decision · 1 action");
  });

  it("says so when there is no report", () => {
    expect(logEntrySubtitle(loggedMeeting(toLogEntry(meeting, null)))).toBe("No report");
  });

  it("says so when the report is only a summary", () => {
    expect(logEntrySubtitle(loggedMeeting(toLogEntry(meeting, {
      summary: "Short one.", key_points: [], action_items: [], analysis: null,
    })))).toBe("Summary only");
  });

  it("singularises a count of one", () => {
    expect(logEntrySubtitle(loggedMeeting(toLogEntry(meeting, { ...report, key_points: ["Only one"] }))))
      .toContain("1 key point ·");
  });
});

// ── Attendance ─────────────────────────────────────────────────────────────

describe("log entries for a meeting the viewer was not in", () => {
  const meeting = {
    id: "m1",
    room_code: "abc-def",
    title: "Board sync",
    created_at: "2026-09-01T10:00:00.000Z",
    started_at: "2026-09-01T10:00:00.000Z",
    ended_at: "2026-09-01T10:45:00.000Z",
    scheduled_at: null,
    duration_minutes: null,
    status: "ended",
    attendees: null,
  };

  it("treats a meeting as attended unless told otherwise", () => {
    expect(toLogEntry(meeting, null).attended).toBe(true);
  });

  it("carries the flag through", () => {
    expect(toLogEntry(meeting, null, false).attended).toBe(false);
  });

  it("says attendees-only rather than 'No report'", () => {
    // RLS empties the report for a non-attendee, so hasReport is false for a
    // report that very much exists. Labelling that "No report" would have the
    // log misreport its own contents.
    expect(logEntrySubtitle(loggedMeeting(toLogEntry(meeting, null, false)))).toBe("Attendees only");
    expect(logEntrySubtitle(loggedMeeting(toLogEntry(meeting, null, true)))).toBe("No report");
  });

  it("still describes a report the viewer did attend", () => {
    const report = { summary: "Discussed the raise.", key_points: ["a", "b"], action_items: null, analysis: null };
    expect(logEntrySubtitle(loggedMeeting(toLogEntry(meeting, report, true)))).toBe("2 key points");
  });
});
