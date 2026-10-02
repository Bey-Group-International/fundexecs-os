import { LONG_RUN_TIMEOUT_MS } from "@/lib/anthropic-client";
import {
  PRESENCE_STALE_MS,
  attendanceRecord,
  guestAttendanceUrl,
  participantConflictTarget,
  attendedButNotHosted,
  canViewReport,
  isPresent,
  presenceByMeeting,
  REPORT_WAIT_LIMIT_MS,
  reportIsReadable,
  reportViewState,
  shouldPollReport,
} from "./attendance";

const NOW = new Date("2026-09-08T12:00:00.000Z");
const T = NOW.getTime();

const MEMBER = { kind: "member", userId: "u1" } as const;
const GUEST = { kind: "guest", guestKey: "g-77" } as const;

describe("participantConflictTarget", () => {
  // The upsert shipped naming a constraint that did not exist, so every join
  // was rejected with 42P10 and the table stayed empty. The columns here and
  // the unique indexes in the migrations are one fact in two places.
  it("names the member index for a member", () => {
    expect(participantConflictTarget(MEMBER)).toBe("meeting_id,user_id");
  });

  /**
   * A guest cannot use the member index, and not for tidiness: NULLs are
   * distinct in a unique index, so `(meeting_id, user_id)` constrains nothing
   * about a row whose user_id is NULL. Every reload would insert another row.
   */
  it("names the guest index for a guest", () => {
    expect(participantConflictTarget(GUEST)).toBe("meeting_id,guest_key");
  });

  it("never gives the two kinds the same arbiter", () => {
    expect(participantConflictTarget(MEMBER)).not.toBe(participantConflictTarget(GUEST));
  });
});

describe("attendanceRecord", () => {
  it("records the member with a timestamp, and no guest key", () => {
    expect(attendanceRecord("m1", MEMBER, "Harvey Specter", NOW)).toEqual({
      meeting_id: "m1",
      user_id: "u1",
      guest_key: null,
      display_name: "Harvey Specter",
      joined_at: "2026-09-08T12:00:00.000Z",
      left_at: null,
    });
  });

  /**
   * The row that could not be written at all before this. `user_id` was always
   * nullable, but the table's only policy is `user_id = auth.uid()` — for a
   * guest that compares NULL to NULL, which is not true, so every insert was
   * denied silently. The guest was absent from the head-count, absent from the
   * report, and locked out of the report themselves.
   */
  it("records a guest by the key their browser holds, and no account", () => {
    expect(attendanceRecord("m1", GUEST, "Dana", NOW)).toEqual({
      meeting_id: "m1",
      user_id: null,
      guest_key: "g-77",
      display_name: "Dana",
      joined_at: "2026-09-08T12:00:00.000Z",
      left_at: null,
    });
  });

  /** Both columns are always present. A row that omitted one would leave the
   *  previous value in place on an upsert, which is how a guest row could end
   *  up carrying somebody else's account. */
  it("always writes both identity columns, so an upsert cannot keep a stale one", () => {
    expect(Object.keys(attendanceRecord("m1", GUEST, "Dana", NOW)).sort())
      .toEqual(Object.keys(attendanceRecord("m1", MEMBER, "Harvey", NOW)).sort());
  });

  it("clears a previous departure, so a rejoin reads as present", () => {
    expect(attendanceRecord("m1", MEMBER, "Harvey", NOW).left_at).toBeNull();
    expect(attendanceRecord("m1", GUEST, "Dana", NOW).left_at).toBeNull();
  });

  it("falls back rather than storing a blank name", () => {
    expect(attendanceRecord("m1", MEMBER, "   ", NOW).display_name).toBe("Guest");
    expect(attendanceRecord("m1", GUEST, "", NOW).display_name).toBe("Guest");
  });
});

/**
 * The guest write has no other way in, so the address it is sent to is part of
 * the contract rather than a detail. The route reads the key from the QUERY
 * STRING — it is what `authorizeMeetingCaller` checks the admission against —
 * so a wrong parameter name is not a 404 you would notice but a 401 that reads
 * exactly like a guest who was never admitted.
 */
describe("guestAttendanceUrl", () => {
  it("names the parameter the route authorises on", () => {
    expect(guestAttendanceUrl("m1", "g-7")).toBe("/api/meetings/m1/attendance?guestKey=g-7");
  });

  it("escapes a key that would otherwise change the query", () => {
    // A key is a uuid today, but it is read out of localStorage, where anything
    // could be sitting — and an unescaped `&` would silently truncate it.
    expect(guestAttendanceUrl("m1", "a&b=c")).toBe("/api/meetings/m1/attendance?guestKey=a%26b%3Dc");
  });

  it("escapes the meeting id too, so a path cannot be climbed out of", () => {
    expect(guestAttendanceUrl("../admin", "g")).toBe("/api/meetings/..%2Fadmin/attendance?guestKey=g");
  });

  /** Arrival and departure must address the same row; they share this. */
  it("is stable for the same pair", () => {
    expect(guestAttendanceUrl("m1", "g-7")).toBe(guestAttendanceUrl("m1", "g-7"));
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

  /**
   * The head-count a host reads off the meetings list. A guest reloading used
   * to insert a second row — `(meeting_id, user_id)` cannot constrain a NULL
   * user_id — so one person showed as two. The partial guest index stops the
   * row being written; this stops the number being wrong if one ever was.
   */
  it("counts one guest once, however many rows they left behind", () => {
    const row = (over: Record<string, unknown>) => ({
      meeting_id: "a",
      display_name: "Dana",
      joined_at: new Date(T - 1000).toISOString(),
      ...over,
    });
    const presence = presenceByMeeting(
      [row({ guest_key: "g-1" }), row({ guest_key: "g-1" }), row({ guest_key: "g-1" })],
      T,
    );
    expect(presence.a).toEqual({ count: 1, names: ["Dana"] });
  });

  it("counts one member once, by their account", () => {
    const row = { meeting_id: "a", display_name: "Harvey", joined_at: new Date(T - 1000).toISOString(), user_id: "u1" };
    expect(presenceByMeeting([row, { ...row }], T).a.count).toBe(1);
  });

  /** A guest key shaped like an account id must not match an account. The
   *  prefixing in `subjectKey` is what prevents it; this is the caller that
   *  would show the collision as a missing person. */
  it("never mistakes a guest for a member with the same identifier", () => {
    const base = { meeting_id: "a", joined_at: new Date(T - 1000).toISOString() };
    const presence = presenceByMeeting(
      [
        { ...base, display_name: "Harvey", user_id: "same-id" },
        { ...base, display_name: "Dana", guest_key: "same-id" },
      ],
      T,
    );
    expect(presence.a.count).toBe(2);
  });

  /**
   * A row naming nobody still counts. It cannot be de-duplicated — nothing
   * tells it from the next one like it — but dropping it would hide somebody
   * who was in the room from the count of who is in the room, and understating
   * a head-count is the worse of the two errors.
   */
  it("counts a row that names nobody, rather than hiding them", () => {
    const row = { meeting_id: "a", display_name: "?", joined_at: new Date(T - 1000).toISOString() };
    expect(presenceByMeeting([row, { ...row }], T).a.count).toBe(2);
  });

  /**
   * This is handed rows for MANY meetings at once — the meetings list reads
   * every live room in one query — so the de-duplication has to be per meeting.
   * Keyed on identity alone, somebody in two live rooms would be counted in
   * only the first, and the second room would show a head-count short.
   */
  it("counts the same person in two meetings once in each", () => {
    const joined = new Date(T - 1000).toISOString();
    const presence = presenceByMeeting(
      [
        { meeting_id: "a", display_name: "Harvey", joined_at: joined, user_id: "u1" },
        { meeting_id: "b", display_name: "Harvey", joined_at: joined, user_id: "u1" },
      ],
      T,
    );
    expect(presence.a.count).toBe(1);
    expect(presence.b.count).toBe(1);
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
    hasReport: true,
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
    expect(reportViewState({ ...base, viewerId: "someone-else", hasReport: false, hasSummary: false })).toBe("forbidden");
    expect(reportViewState({ ...base, viewerId: "someone-else", hasSummary: true })).toBe("forbidden");
  });

  it("shows the report to an attendee", () => {
    expect(reportViewState({ ...base, viewerId: "u2", attended: true })).toBe("ready");
  });

  it("waits on a report the attendee is entitled to but that isn't written yet", () => {
    expect(reportViewState({
      ...base, viewerId: "u2", attended: true, hasReport: false, hasSummary: false,
    })).toBe("generating");
  });

  // The defect this splits apart. The report route writes a row with an empty
  // summary when the model fails, and again when a one-way call had nothing to
  // transcribe — both finished outcomes. Keyed on the summary alone, the page
  // called that "generating" and sat on a spinner forever, polling every five
  // seconds, with the recording and the transcript readable behind it.
  it("treats a report written without a summary as finished, not pending", () => {
    expect(reportViewState({ ...base, hasReport: true, hasSummary: false })).toBe("unsummarised");
  });

  it("does not confuse an unsummarised report with a missing one", () => {
    const missing = reportViewState({ ...base, hasReport: false, hasSummary: false });
    const unsummarised = reportViewState({ ...base, hasReport: true, hasSummary: false });
    expect(missing).not.toBe(unsummarised);
  });

  // A report that is genuinely never coming has to stop being awaited, or the
  // page polls for the life of the tab.
  it("gives up once it has waited long enough", () => {
    const waiting = { ...base, hasReport: false, hasSummary: false };
    expect(reportViewState({ ...waiting, waitedMs: 0 })).toBe("generating");
    expect(reportViewState({ ...waiting, waitedMs: REPORT_WAIT_LIMIT_MS - 1 })).toBe("generating");
    expect(reportViewState({ ...waiting, waitedMs: REPORT_WAIT_LIMIT_MS })).toBe("stalled");
  });

  // Waiting is not a reason to hide a report that did arrive.
  it("never calls a report that exists stalled, however long the wait", () => {
    expect(reportViewState({ ...base, waitedMs: REPORT_WAIT_LIMIT_MS * 10 })).toBe("ready");
    expect(reportViewState({
      ...base, hasSummary: false, waitedMs: REPORT_WAIT_LIMIT_MS * 10,
    })).toBe("unsummarised");
  });
});

describe("reportIsReadable", () => {
  // Both of these have a page worth rendering; the difference is only whether
  // there is a summary at the top of it.
  it("is true for a report with or without a summary", () => {
    expect(reportIsReadable("ready")).toBe(true);
    expect(reportIsReadable("unsummarised")).toBe(true);
  });

  it("is false for every state with nothing to show", () => {
    for (const state of ["loading", "missing", "forbidden", "generating", "stalled"] as const) {
      expect(reportIsReadable(state)).toBe(false);
    }
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
    // The two that used to poll forever: a finished report with no summary,
    // and a wait that has gone on long enough to be hopeless.
    expect(shouldPollReport("unsummarised")).toBe(false);
    expect(shouldPollReport("stalled")).toBe(false);
  });
});

describe("the wait limit against the generation it waits for", () => {
  // The two have to agree, and they live in different files. A limit shorter
  // than the worst-case model call declares a report dead while it is still
  // being written — and since giving up also stops the polling, the report
  // that lands a moment later is never shown without a manual reload.
  it("outlasts the worst case of the call it is waiting on", () => {
    const worstCase = LONG_RUN_TIMEOUT_MS * 2; // maxRetries: 1
    expect(REPORT_WAIT_LIMIT_MS).toBeGreaterThan(worstCase);
  });

  // And is still bounded: the whole point is that the page stops eventually.
  it("is still a bound, not forever", () => {
    expect(REPORT_WAIT_LIMIT_MS).toBeLessThan(15 * 60_000);
  });
});
