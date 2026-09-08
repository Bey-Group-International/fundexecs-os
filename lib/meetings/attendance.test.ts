import {
  PARTICIPANT_CONFLICT_TARGET,
  PRESENCE_STALE_MS,
  attendanceRecord,
  attendedButNotHosted,
  canViewReport,
  isPresent,
  presenceByMeeting,
  reportViewState,
  shouldPollReport,
} from "./attendance";

const NOW = new Date("2026-09-08T12:00:00.000Z");
const T = NOW.getTime();

describe("PARTICIPANT_CONFLICT_TARGET", () => {
  // The upsert shipped naming a constraint that did not exist, so every join
  // was rejected with 42P10 and the table stayed empty. The columns here and
  // the UNIQUE constraint in the migration are one fact in two places.
  it("names the columns of the unique constraint", () => {
    expect(PARTICIPANT_CONFLICT_TARGET).toBe("meeting_id,user_id");
  });
});

describe("attendanceRecord", () => {
  it("records the member with a timestamp", () => {
    expect(attendanceRecord("m1", "u1", "Harvey Specter", NOW)).toEqual({
      meeting_id: "m1",
      user_id: "u1",
      display_name: "Harvey Specter",
      joined_at: "2026-09-08T12:00:00.000Z",
      left_at: null,
    });
  });

  it("clears a previous departure, so a rejoin reads as present", () => {
    expect(attendanceRecord("m1", "u1", "Harvey", NOW).left_at).toBeNull();
  });

  it("falls back rather than storing a blank name", () => {
    expect(attendanceRecord("m1", "u1", "   ", NOW).display_name).toBe("Guest");
  });
});

describe("isPresent", () => {
  it("counts a member who has not left", () => {
    expect(isPresent({ meeting_id: "m", display_name: "A", joined_at: new Date(T - 1000).toISOString() }, T)).toBe(true);
  });

  it("does not count a member who left", () => {
    expect(isPresent({
      meeting_id: "m",
      display_name: "A",
      joined_at: new Date(T - 1000).toISOString(),
      left_at: new Date(T - 500).toISOString(),
    }, T)).toBe(false);
  });

  it("stops believing a row whose tab died hours ago", () => {
    const joined = new Date(T - PRESENCE_STALE_MS - 1).toISOString();
    expect(isPresent({ meeting_id: "m", display_name: "A", joined_at: joined }, T)).toBe(false);
  });

  it("keeps a row that is stale but not yet past the ceiling", () => {
    const joined = new Date(T - PRESENCE_STALE_MS + 1000).toISOString();
    expect(isPresent({ meeting_id: "m", display_name: "A", joined_at: joined }, T)).toBe(true);
  });

  it("treats an unreadable timestamp as present rather than absent", () => {
    expect(isPresent({ meeting_id: "m", display_name: "A", joined_at: "not a date" }, T)).toBe(true);
  });
});

describe("presenceByMeeting", () => {
  const rows = [
    { meeting_id: "a", display_name: "Harvey", joined_at: new Date(T - 60_000).toISOString() },
    { meeting_id: "a", display_name: "Donna", joined_at: new Date(T - 30_000).toISOString() },
    { meeting_id: "a", display_name: "Louis", joined_at: new Date(T - 90_000).toISOString(), left_at: new Date(T).toISOString() },
    { meeting_id: "b", display_name: "Jessica", joined_at: new Date(T - 10_000).toISOString() },
  ];

  it("counts only the people still in each room", () => {
    const presence = presenceByMeeting(rows, T);
    expect(presence.a).toEqual({ count: 2, names: ["Harvey", "Donna"] });
    expect(presence.b).toEqual({ count: 1, names: ["Jessica"] });
  });

  it("caps the names it carries but not the count", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      meeting_id: "a",
      display_name: `P${i}`,
      joined_at: new Date(T - 1000).toISOString(),
    }));
    const presence = presenceByMeeting(many, T, 3);
    expect(presence.a.count).toBe(12);
    expect(presence.a.names).toEqual(["P0", "P1", "P2"]);
  });

  it("omits a meeting nobody is in", () => {
    expect(presenceByMeeting([rows[2]], T)).toEqual({});
  });
});

describe("attendedButNotHosted", () => {
  it("drops the meetings the member hosted", () => {
    expect(attendedButNotHosted(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
  });

  it("collapses the repeated rows a rejoin used to leave behind", () => {
    expect(attendedButNotHosted(["a", "a", "b"], [])).toEqual(["a", "b"]);
  });

  it("ignores empty ids", () => {
    expect(attendedButNotHosted(["", "a"], [])).toEqual(["a"]);
  });
});

describe("canViewReport", () => {
  it("lets the host in", () => {
    expect(canViewReport({ hostId: "u1", viewerId: "u1", attended: false })).toBe(true);
  });

  it("lets an attendee in", () => {
    expect(canViewReport({ hostId: "u9", viewerId: "u1", attended: true })).toBe(true);
  });

  it("keeps out a co-member who was never in the room", () => {
    expect(canViewReport({ hostId: "u9", viewerId: "u1", attended: false })).toBe(false);
  });

  it("keeps out a signed-out viewer", () => {
    expect(canViewReport({ hostId: null, viewerId: null, attended: true })).toBe(false);
  });
});

describe("reportViewState", () => {
  const base = {
    loaded: true,
    meetingExists: true,
    hostId: "host",
    viewerId: "host",
    attended: false,
    hasSummary: true,
  };

  it("waits while the first fetch is in flight", () => {
    expect(reportViewState({ ...base, loaded: false })).toBe("loading");
  });

  it("reports a meeting that is not there", () => {
    expect(reportViewState({ ...base, meetingExists: false })).toBe("missing");
  });

  it("says forbidden rather than generating for a non-attendee", () => {
    // The bug this ordering fixes: RLS hides the report row from a non-attendee,
    // which is byte-for-byte what an unwritten report looks like, so the page
    // sat on "Generating your report…" for a report it would never be shown.
    expect(reportViewState({ ...base, viewerId: "someone-else", hasSummary: false })).toBe("forbidden");
    expect(reportViewState({ ...base, viewerId: "someone-else", hasSummary: true })).toBe("forbidden");
  });

  it("shows the report to an attendee", () => {
    expect(reportViewState({ ...base, viewerId: "u2", attended: true })).toBe("ready");
  });

  it("waits on a report the attendee is entitled to but that isn't written yet", () => {
    expect(reportViewState({ ...base, viewerId: "u2", attended: true, hasSummary: false })).toBe("generating");
  });
});

describe("shouldPollReport", () => {
  it("polls only while a report could still arrive", () => {
    expect(shouldPollReport("loading")).toBe(true);
    expect(shouldPollReport("generating")).toBe(true);
  });

  it("stops polling once the answer cannot change", () => {
    expect(shouldPollReport("ready")).toBe(false);
    expect(shouldPollReport("forbidden")).toBe(false);
    expect(shouldPollReport("missing")).toBe(false);
  });
});
