import {
  validateMeetingDraft,
  isValidDraft,
  durationMinutesFromTimes,
  localToIso,
  deriveMeetingStatus,
  isPastMeeting,
  isUpcomingMeeting,
  upcomingWindowStart,
  MAX_MEETING_MINUTES,
  wasEditedAfterSave,
  findConflicts,
  nextExternalSyncStatus,
  meetingTimeState,
} from "./schedule";
import { PRESENCE_STALE_MS } from "./attendance";

describe("validateMeetingDraft", () => {
  const valid = {
    title: "Q3 LP Review",
    meetingType: "lp_review",
    date: "2026-07-10",
    startTime: "10:00",
    endTime: "11:00",
    timezone: "America/New_York",
  };

  it("passes a complete draft", () => {
    expect(validateMeetingDraft(valid)).toEqual({});
    expect(isValidDraft(valid)).toBe(true);
  });

  it("flags every missing required field", () => {
    const errors = validateMeetingDraft({});
    expect(Object.keys(errors).sort()).toEqual(
      ["date", "endTime", "meetingType", "startTime", "timezone", "title"].sort(),
    );
  });

  it("rejects end time before or equal to start time", () => {
    expect(validateMeetingDraft({ ...valid, endTime: "10:00" }).endTime).toBeDefined();
    expect(validateMeetingDraft({ ...valid, endTime: "09:30" }).endTime).toBeDefined();
  });

  it("rejects malformed date and time", () => {
    expect(validateMeetingDraft({ ...valid, date: "07/10/2026" }).date).toBeDefined();
    expect(validateMeetingDraft({ ...valid, startTime: "9am" }).startTime).toBeDefined();
  });
});

describe("time helpers", () => {
  it("computes duration between HH:mm times", () => {
    expect(durationMinutesFromTimes("10:00", "11:30")).toBe(90);
    expect(durationMinutesFromTimes("09:15", "10:00")).toBe(45);
  });

  it("converts local wall-clock to a UTC instant using the zone offset", () => {
    // 10:00 in New York (EDT, -04:00 in July) is 14:00 UTC.
    expect(localToIso("2026-07-10", "10:00", "America/New_York")).toBe("2026-07-10T14:00:00.000Z");
    // 10:00 UTC stays 10:00 UTC.
    expect(localToIso("2026-07-10", "10:00", "UTC")).toBe("2026-07-10T10:00:00.000Z");
  });

  it("resolves times correctly on both sides of a DST transition", () => {
    // US spring-forward 2026: 02:00 EST jumps to 03:00 EDT on 2026-03-08.
    // Before the transition the offset is -05:00 (EST); after, -04:00 (EDT).
    expect(localToIso("2026-03-08", "01:30", "America/New_York")).toBe("2026-03-08T06:30:00.000Z"); // EST -5
    expect(localToIso("2026-03-08", "03:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z"); // EDT -4
    // Fall-back 2026: clocks go 02:00 EDT -> 01:00 EST on 2026-11-01.
    expect(localToIso("2026-11-01", "03:00", "America/New_York")).toBe("2026-11-01T08:00:00.000Z"); // EST -5
  });

  // Regression: on Node 20's ICU, `hour12: false` renders midnight-in-zone as
  // hour "24", and feeding that to Date.UTC rolls it to the next day — which
  // resolved every 00:00 local time a full day early. Invisible on Node 22+,
  // where the same formatter reports "00", so these pin the contract directly.
  it("resolves midnight local time in a zone ahead of UTC", () => {
    expect(localToIso("2026-03-03", "00:00", "Asia/Tokyo")).toBe("2026-03-02T15:00:00.000Z");
    expect(localToIso("2026-03-03", "00:30", "Asia/Tokyo")).toBe("2026-03-02T15:30:00.000Z");
  });

  it("resolves midnight local time in a zone behind UTC", () => {
    expect(localToIso("2026-07-10", "00:00", "America/New_York")).toBe("2026-07-10T04:00:00.000Z");
    expect(localToIso("2026-07-10", "00:00", "America/Los_Angeles")).toBe("2026-07-10T07:00:00.000Z");
  });

  it("keeps midnight distinct from the following midnight", () => {
    const first = localToIso("2026-03-03", "00:00", "Asia/Tokyo");
    const next = localToIso("2026-03-04", "00:00", "Asia/Tokyo");
    expect(new Date(next).getTime() - new Date(first).getTime()).toBe(24 * 3600_000);
  });
});

describe("deriveMeetingStatus", () => {
  const now = new Date("2026-07-10T09:00:00.000Z").getTime();
  const base = { scheduled_at: "2026-07-10T10:00:00.000Z", duration_minutes: 60 };

  it("returns Live for an active room", () => {
    expect(deriveMeetingStatus({ ...base, status: "active" }, now)).toBe("Live");
  });

  it("returns Completed for an ended room", () => {
    expect(deriveMeetingStatus({ ...base, status: "ended" }, now)).toBe("Completed");
  });

  it("returns Follow-Up Needed when follow-up is open after end", () => {
    expect(deriveMeetingStatus({ ...base, status: "ended", followup_status: "draft" }, now)).toBe("Follow-Up Needed");
  });

  it("returns Prep Needed / Ready from preparation status", () => {
    expect(deriveMeetingStatus({ ...base, status: "waiting", preparation_status: "prep_needed" }, now)).toBe("Prep Needed");
    expect(deriveMeetingStatus({ ...base, status: "waiting", preparation_status: "ready" }, now)).toBe("Ready");
  });

  it("returns Updated after a deliberate edit", () => {
    expect(
      deriveMeetingStatus(
        { ...base, status: "waiting", locked_at: "2026-07-09T10:00:00.000Z", updated_at: "2026-07-09T12:00:00.000Z" },
        now,
      ),
    ).toBe("Updated");
  });

  it("treats a passed end time as Completed even if the room never ended", () => {
    const later = new Date("2026-07-10T12:00:00.000Z").getTime();
    expect(deriveMeetingStatus({ ...base, status: "waiting" }, later)).toBe("Completed");
  });

  it("treats a passed end time with follow-up done as Completed, not Follow-Up Needed", () => {
    const later = new Date("2026-07-10T12:00:00.000Z").getTime();
    expect(deriveMeetingStatus({ ...base, status: "waiting", followup_status: "done" }, later)).toBe("Completed");
    // …but an open follow-up on a passed-end meeting still needs follow-up.
    expect(deriveMeetingStatus({ ...base, status: "waiting", followup_status: "draft" }, later)).toBe("Follow-Up Needed");
  });
});

describe("isPastMeeting", () => {
  const now = new Date("2026-07-11T12:00:00.000Z").getTime();

  it("keeps a future meeting OUT of Past (the reported bug)", () => {
    expect(isPastMeeting({ status: "waiting", scheduled_at: "2026-07-12T10:00:00.000Z", duration_minutes: 60 }, now)).toBe(false);
  });

  it("keeps an in-progress meeting OUT of Past (end still ahead)", () => {
    expect(isPastMeeting({ status: "active", scheduled_at: "2026-07-11T11:30:00.000Z", duration_minutes: 60 }, now)).toBe(false);
  });

  it("puts a meeting whose scheduled end has passed into Past", () => {
    expect(isPastMeeting({ status: "waiting", scheduled_at: "2026-07-11T10:00:00.000Z", duration_minutes: 60 }, now)).toBe(true);
  });

  it("puts an ended room into Past regardless of time", () => {
    expect(isPastMeeting({ status: "ended", scheduled_at: "2026-07-12T10:00:00.000Z", duration_minutes: 60 }, now)).toBe(true);
  });

  it("never lists a draft", () => {
    expect(isPastMeeting({ status: "waiting", scheduled_at: "2026-07-10T10:00:00.000Z", duration_minutes: 60, is_draft: true }, now)).toBe(false);
  });

  it("treats an ad-hoc room with no scheduled time as Past only once ended", () => {
    expect(isPastMeeting({ status: "active", scheduled_at: null }, now)).toBe(false);
    expect(isPastMeeting({ status: "ended", scheduled_at: null }, now)).toBe(true);
  });

  // `status: "ended"` is written by exactly one thing — the report route, when a
  // meeting is closed down properly. A host who shuts the tab leaves the row
  // `active` forever, and with no scheduled_at there is no window to have passed
  // either. Such a meeting was in NO list anywhere: it existed, it held its
  // recording and its report, and the product showed it nowhere.
  describe("an ad-hoc room nobody ever ended", () => {
    const stale = new Date(now - PRESENCE_STALE_MS - 60_000).toISOString();
    const fresh = new Date(now - 5 * 60_000).toISOString();

    it("is Past once it is older than attendance would believe anyone is in it", () => {
      expect(isPastMeeting({ status: "active", scheduled_at: null, started_at: stale }, now)).toBe(true);
    });

    it("is not Past while it could still be happening", () => {
      // Somebody may be about to join the room they just opened.
      expect(isPastMeeting({ status: "active", scheduled_at: null, started_at: fresh }, now)).toBe(false);
    });

    it("falls back to when the row was created if the room never started", () => {
      expect(isPastMeeting({ status: "waiting", scheduled_at: null, created_at: stale }, now)).toBe(true);
      expect(isPastMeeting({ status: "waiting", scheduled_at: null, created_at: fresh }, now)).toBe(false);
    });

    it("prefers when the room opened over when the row was made", () => {
      expect(
        isPastMeeting({ status: "active", scheduled_at: null, started_at: fresh, created_at: stale }, now),
      ).toBe(false);
    });

    it("stays out of Past when there is no timestamp to judge by", () => {
      // Better left out than dropped in on a guess.
      expect(isPastMeeting({ status: "active", scheduled_at: null, started_at: null, created_at: null }, now)).toBe(false);
    });

    it("is never Upcoming either way", () => {
      // There is nothing to count down to, fresh or stale.
      expect(isUpcomingMeeting({ status: "active", scheduled_at: null, started_at: stale }, now)).toBe(false);
      expect(isUpcomingMeeting({ status: "active", scheduled_at: null, started_at: fresh }, now)).toBe(false);
    });
  });
});

describe("isUpcomingMeeting", () => {
  const now = new Date("2026-07-11T12:00:00.000Z").getTime();

  // The defect this exists for. The meetings page keyed Upcoming off the
  // meeting's END, /api/meetings/upcoming keyed it off the START in SQL, and the
  // list refetches that route on mount — so a meeting already running rendered
  // on first paint and vanished a second later, taking its Join button with it.
  it("keeps a meeting that is already running in Upcoming", () => {
    const running = { status: "active" as const, scheduled_at: "2026-07-11T11:30:00.000Z", duration_minutes: 60 };
    expect(isUpcomingMeeting(running, now)).toBe(true);
    // In progress is where the live state and the presence count render, so it
    // is the row somebody acts on.
    expect(isPastMeeting(running, now)).toBe(false);
  });

  it("keeps a future meeting in Upcoming", () => {
    expect(isUpcomingMeeting({ status: "waiting", scheduled_at: "2026-07-12T10:00:00.000Z", duration_minutes: 60 }, now)).toBe(true);
  });

  it("drops a meeting whose scheduled end has passed", () => {
    expect(isUpcomingMeeting({ status: "waiting", scheduled_at: "2026-07-11T10:00:00.000Z", duration_minutes: 60 }, now)).toBe(false);
  });

  it("drops an ended room even while its scheduled window is still open", () => {
    // A meeting that finished early should not sit in Upcoming until its
    // scheduled end passes.
    expect(isUpcomingMeeting({ status: "ended", scheduled_at: "2026-07-11T11:30:00.000Z", duration_minutes: 60 }, now)).toBe(false);
  });

  it("never lists a draft", () => {
    expect(isUpcomingMeeting({ status: "waiting", scheduled_at: "2026-07-12T10:00:00.000Z", duration_minutes: 60, is_draft: true }, now)).toBe(false);
  });

  it("does not count an ad-hoc room with no scheduled time", () => {
    // There is nothing to count down to, and isPastMeeting says the same.
    expect(isUpcomingMeeting({ status: "active", scheduled_at: null }, now)).toBe(false);
  });

  it("defaults a missing duration to an hour, like isPastMeeting", () => {
    expect(isUpcomingMeeting({ status: "waiting", scheduled_at: "2026-07-11T11:30:00.000Z" }, now)).toBe(true);
    expect(isUpcomingMeeting({ status: "waiting", scheduled_at: "2026-07-11T10:30:00.000Z" }, now)).toBe(false);
  });

  // The claim isPastMeeting's docstring has always made, now checkable: a
  // meeting lands in exactly one list. Three separate expressions of this
  // partition existed and two disagreed; the point of the pair is that they
  // cannot.
  describe("as the complement of isPastMeeting", () => {
    const cases = [
      { status: "waiting" as const, scheduled_at: "2026-07-12T10:00:00.000Z", duration_minutes: 60 },
      { status: "active" as const, scheduled_at: "2026-07-11T11:30:00.000Z", duration_minutes: 60 },
      { status: "waiting" as const, scheduled_at: "2026-07-11T10:00:00.000Z", duration_minutes: 60 },
      { status: "ended" as const, scheduled_at: "2026-07-12T10:00:00.000Z", duration_minutes: 60 },
      { status: "ended" as const, scheduled_at: "2026-07-11T11:30:00.000Z", duration_minutes: 60 },
      { status: "waiting" as const, scheduled_at: "2026-07-11T11:59:00.000Z", duration_minutes: 15 },
      { status: "active" as const, scheduled_at: null },
      { status: "ended" as const, scheduled_at: null },
    ];

    it("never puts one meeting in both lists", () => {
      for (const c of cases) {
        expect(isUpcomingMeeting(c, now) && isPastMeeting(c, now)).toBe(false);
      }
    });

    it("places every scheduled, non-draft meeting in one of them", () => {
      // The only remaining gap is an ad-hoc room young enough that it could
      // still be happening: it is neither coming up nor over, and both functions
      // agree on that. Once it is stale, isPastMeeting claims it.
      for (const c of cases.filter((x) => x.scheduled_at !== null)) {
        expect(isUpcomingMeeting(c, now) || isPastMeeting(c, now)).toBe(true);
      }
    });

    it("puts a draft in neither", () => {
      const draft = { status: "waiting" as const, scheduled_at: "2026-07-12T10:00:00.000Z", is_draft: true };
      expect(isUpcomingMeeting(draft, now)).toBe(false);
      expect(isPastMeeting(draft, now)).toBe(false);
    });
  });
});

describe("upcomingWindowStart", () => {
  // What lets a SQL query express an end-time rule: fetch everything that could
  // still be running, then narrow with isUpcomingMeeting.
  it("reaches back the longest a meeting can run", () => {
    const now = new Date("2026-07-11T12:00:00.000Z").getTime();
    expect(upcomingWindowStart(now).toISOString()).toBe("2026-07-11T04:00:00.000Z");
  });

  it("covers the longest meeting the platform allows", () => {
    // Derived from the clamp rather than picked, so raising the maximum meeting
    // length cannot quietly start dropping long meetings out of the fetch.
    const now = Date.now();
    const longest = {
      status: "waiting" as const,
      scheduled_at: new Date(now - (MAX_MEETING_MINUTES - 1) * 60_000).toISOString(),
      duration_minutes: MAX_MEETING_MINUTES,
    };
    expect(isUpcomingMeeting(longest, now)).toBe(true);
    expect(new Date(longest.scheduled_at).getTime()).toBeGreaterThanOrEqual(upcomingWindowStart(now).getTime());
  });
});

describe("wasEditedAfterSave", () => {
  it("is false without both timestamps", () => {
    expect(wasEditedAfterSave({ locked_at: "2026-07-09T10:00:00.000Z" })).toBe(false);
  });
  it("is true when updated well after locked", () => {
    expect(
      wasEditedAfterSave({ locked_at: "2026-07-09T10:00:00.000Z", updated_at: "2026-07-09T11:00:00.000Z" }),
    ).toBe(true);
  });
});

describe("meetingTimeState", () => {
  const start = "2026-07-10T10:00:00.000Z";

  it("returns null without a scheduled time", () => {
    expect(meetingTimeState(null, 60)).toBeNull();
  });

  it("counts down while upcoming", () => {
    const now = new Date("2026-07-10T09:48:00.000Z").getTime();
    const state = meetingTimeState(start, 60, now)!;
    expect(state.phase).toBe("upcoming");
    expect(state.label).toBe("in 12 mins");
    expect(state.minutesToStart).toBe(12);
  });

  it("flips to imminent within the last two minutes", () => {
    const now = new Date("2026-07-10T09:59:00.000Z").getTime();
    expect(meetingTimeState(start, 60, now)!.phase).toBe("imminent");
    expect(meetingTimeState(start, 60, now)!.label).toBe("Starts now");
  });

  it("reports time left while in progress", () => {
    const now = new Date("2026-07-10T10:36:00.000Z").getTime();
    const state = meetingTimeState(start, 60, now)!;
    expect(state.phase).toBe("in_progress");
    expect(state.label).toBe("24 mins left");
  });

  it("is ended once the window has passed", () => {
    const now = new Date("2026-07-10T11:30:00.000Z").getTime();
    expect(meetingTimeState(start, 60, now)!.phase).toBe("ended");
  });

  it("humanizes hours and days for distant meetings", () => {
    expect(meetingTimeState(start, 60, new Date("2026-07-10T07:00:00.000Z").getTime())!.label).toBe("in 3 hrs");
    expect(meetingTimeState(start, 60, new Date("2026-07-08T10:00:00.000Z").getTime())!.label).toBe("in 2 days");
  });
});

describe("findConflicts", () => {
  const candidates = [
    { id: "a", title: "Standup", scheduled_at: "2026-07-10T10:00:00.000Z", duration_minutes: 30 },
    { id: "b", title: "Board", scheduled_at: "2026-07-10T11:00:00.000Z", duration_minutes: 60 },
  ];

  it("detects overlapping meetings", () => {
    const conflicts = findConflicts(candidates, "2026-07-10T10:15:00.000Z", "2026-07-10T10:45:00.000Z");
    expect(conflicts.map((c) => c.id)).toEqual(["a"]);
  });

  it("excludes the meeting being edited", () => {
    const conflicts = findConflicts(candidates, "2026-07-10T10:00:00.000Z", "2026-07-10T10:30:00.000Z", "a");
    expect(conflicts).toEqual([]);
  });

  it("returns nothing for a non-overlapping slot", () => {
    expect(findConflicts(candidates, "2026-07-10T09:00:00.000Z", "2026-07-10T09:30:00.000Z")).toEqual([]);
  });
});

describe("findConflicts — scoped to shared participants", () => {
  const base = { scheduled_at: "2026-07-10T10:00:00.000Z", duration_minutes: 60 };
  const overlap = ["2026-07-10T10:15:00.000Z", "2026-07-10T10:45:00.000Z"] as const;

  it("ignores an overlap when no participant is shared", () => {
    const candidates = [{ id: "a", ...base, host_id: "host-x", attendees: [{ email: "x@y.z" }] }];
    expect(
      findConflicts(candidates, overlap[0], overlap[1], { subjectHostId: "host-me", subjectEmails: ["me@fund.com"] }),
    ).toEqual([]);
  });

  it("flags an overlap when the host is shared", () => {
    const candidates = [{ id: "a", title: "Other", ...base, host_id: "host-me", attendees: [] }];
    expect(
      findConflicts(candidates, overlap[0], overlap[1], { subjectHostId: "host-me" }).map((c) => c.id),
    ).toEqual(["a"]);
  });

  it("flags an overlap when an attendee email is shared (case-insensitive)", () => {
    const candidates = [{ id: "a", ...base, host_id: "host-x", attendees: [{ email: "Shared@Fund.com" }] }];
    expect(
      findConflicts(candidates, overlap[0], overlap[1], { subjectHostId: "host-me", subjectEmails: ["shared@fund.com"] }).map((c) => c.id),
    ).toEqual(["a"]);
  });

  it("matches the scheduler as a guest on another meeting via their email", () => {
    const candidates = [{ id: "a", ...base, host_id: "host-x", attendees: [{ email: "me@fund.com" }] }];
    expect(
      findConflicts(candidates, overlap[0], overlap[1], { subjectHostId: "host-me", subjectEmails: ["me@fund.com"] }).map((c) => c.id),
    ).toEqual(["a"]);
  });

  it("still ignores non-overlapping meetings even when a person is shared", () => {
    const candidates = [{ id: "a", ...base, host_id: "host-me" }];
    expect(
      findConflicts(candidates, "2026-07-10T09:00:00.000Z", "2026-07-10T09:30:00.000Z", { subjectHostId: "host-me" }),
    ).toEqual([]);
  });
});

describe("nextExternalSyncStatus", () => {
  it("is not_connected without a provider", () => {
    expect(
      nextExternalSyncStatus({ enabled: true, providerConnected: false, isEdit: false, timingOrAttendeesChanged: false }),
    ).toBe("not_connected");
  });

  it("is sync_off when connected but disabled", () => {
    expect(
      nextExternalSyncStatus({ enabled: false, providerConnected: true, isEdit: false, timingOrAttendeesChanged: false }),
    ).toBe("sync_off");
  });

  it("is sync_pending on first save with sync enabled", () => {
    expect(
      nextExternalSyncStatus({ enabled: true, providerConnected: true, isEdit: false, timingOrAttendeesChanged: false }),
    ).toBe("sync_pending");
  });

  it("becomes needs_resync when a synced meeting changes timing", () => {
    expect(
      nextExternalSyncStatus({
        enabled: true,
        providerConnected: true,
        currentStatus: "synced",
        isEdit: true,
        timingOrAttendeesChanged: true,
      }),
    ).toBe("needs_resync");
  });

  it("stays synced when a synced meeting is edited without timing change", () => {
    expect(
      nextExternalSyncStatus({
        enabled: true,
        providerConnected: true,
        currentStatus: "synced",
        isEdit: true,
        timingOrAttendeesChanged: false,
      }),
    ).toBe("synced");
  });
});
