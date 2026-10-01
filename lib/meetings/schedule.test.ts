import {
  nextFreeStart,
  zonedDateTime,
  conflictGate,
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
  findConflictsAcross,
  overlapsAnyWindow,
  nextExternalSyncStatus,
  meetingTimeState,
  pastMeetingDate,
  pastMeetingTime,
  weekdayLabel,
  monthLabel,
  calendarWhenLabel,
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

  it("calls a passed in-app meeting whose room was never opened Missed, not Completed", () => {
    const later = new Date("2026-07-10T12:00:00.000Z").getTime();
    const neverOpened = { ...base, status: "waiting", started_at: null, meeting_url: null };
    expect(deriveMeetingStatus(neverOpened, later)).toBe("Missed");
    expect(deriveMeetingStatus({ ...neverOpened, meeting_url: "" }, later)).toBe("Missed");
    // Still upcoming: not missed yet.
    expect(deriveMeetingStatus({ ...neverOpened, preparation_status: "ready" }, now)).toBe("Ready");
    // An open follow-up still outranks it.
    expect(deriveMeetingStatus({ ...neverOpened, followup_status: "draft" }, later)).toBe("Follow-Up Needed");
  });

  it("does not call a meeting Missed when it may have happened somewhere this app can't see", () => {
    const later = new Date("2026-07-10T12:00:00.000Z").getTime();
    // Held on Zoom / Meet: the room here was never meant to open.
    expect(
      deriveMeetingStatus({ ...base, status: "waiting", started_at: null, meeting_url: "https://zoom.us/j/1" }, later),
    ).toBe("Completed");
    // The room did open.
    expect(
      deriveMeetingStatus({ ...base, status: "waiting", started_at: "2026-07-10T10:01:00.000Z", meeting_url: null }, later),
    ).toBe("Completed");
    // A caller that didn't load started_at can't tell, so it keeps the old reading.
    expect(deriveMeetingStatus({ ...base, status: "waiting" }, later)).toBe("Completed");
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

// The past list draws a date and a time for every finished meeting it shows.
// Both used to be built with `toLocale*`, which constructs an
// Intl.DateTimeFormat, formats one value and discards it: benched at 0.4967ms
// for the pair against 0.0037ms reused, so fifty rows spent 24.83ms of a render
// building formatters.
describe("dates on the past-meetings list", () => {
  // Counted through the per-call API, not the constructor: V8's `toLocale*` does
  // not go through the JS-visible `Intl.DateTimeFormat`, so a spy on the
  // constructor reads zero either way and would pass on the unfixed code.
  it("does not build a formatter per row", () => {
    const date = jest.spyOn(Date.prototype, "toLocaleDateString");
    const time = jest.spyOn(Date.prototype, "toLocaleTimeString");
    try {
      for (let i = 0; i < 200; i++) {
        pastMeetingDate(new Date(Date.UTC(2026, 8, 1 + (i % 28), 14, 5)).toISOString());
        pastMeetingTime(new Date(Date.UTC(2026, 8, 1 + (i % 28), 14, 5)).toISOString());
      }
      expect(date).not.toHaveBeenCalled();
      expect(time).not.toHaveBeenCalled();
    } finally {
      date.mockRestore();
      time.mockRestore();
    }
  });

  // The other half of caching a formatter: that it still says the same thing.
  // A reused formatter is only a safe swap if its output matches the per-call
  // one it replaced, and "Sep 23" against "September 23" down a list of fifty
  // rows is the kind of change nobody notices in a diff.
  it("says exactly what the one-shot formatters said", () => {
    for (const iso of [
      "2026-09-23T14:05:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-12-31T23:59:00.000Z",
      "2025-07-04T12:00:00.000Z",
    ]) {
      const when = new Date(iso);
      expect(pastMeetingDate(iso)).toBe(
        when.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      );
      expect(pastMeetingTime(iso)).toBe(
        when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      );
    }
  });

  // The year is the difference from the upcoming list, and it is not cosmetic:
  // this list reaches back indefinitely, and "Sep 23" in a list spanning two
  // years names two different days.
  it("spells the year, so two Septembers are told apart", () => {
    expect(pastMeetingDate("2025-09-23T14:05:00.000Z")).toContain("2025");
    expect(pastMeetingDate("2026-09-23T14:05:00.000Z")).toContain("2026");
    expect(pastMeetingDate("2025-09-23T14:05:00.000Z")).not.toBe(
      pastMeetingDate("2026-09-23T14:05:00.000Z"),
    );
  });

  // These rows are built from nullable columns and from rows written by older
  // versions of this product. A list of finished meetings is not worth throwing
  // away over one unreadable timestamp, and "Invalid Date" is not a date.
  it("returns null for a timestamp it cannot read, never \"Invalid Date\"", () => {
    for (const bad of [null, undefined, "", "   ", "not a date", "2026-13-45T99:99:99Z"]) {
      expect(pastMeetingDate(bad)).toBeNull();
      expect(pastMeetingTime(bad)).toBeNull();
    }
  });
});

// The calendar overlay draws its weekday header seven times per grid and its
// date-and-time line once per meeting, and a fifteen-second clock re-renders the
// whole grid — so every one of these ran four times a minute for as long as the
// overlay was open. Benched: weekday 0.0584ms vs 0.0008ms reused (75x), the
// date-and-time line 0.0632ms vs 0.0022ms (29x).
describe("the calendar overlay's labels", () => {
  // Through the per-call API, not the constructor: V8's toLocale* does not go
  // through the JS-visible Intl.DateTimeFormat, so a constructor spy reads zero
  // either way and would pass on the unfixed code.
  it("builds no formatter per header or per meeting", () => {
    const d = jest.spyOn(Date.prototype, "toLocaleDateString");
    const s = jest.spyOn(Date.prototype, "toLocaleString");
    try {
      // A month grid's worth: 42 cells, 7 headers, 30 meetings, four times over.
      for (let pass = 0; pass < 4; pass++) {
        for (let i = 0; i < 7; i++) {
          weekdayLabel(new Date(Date.UTC(2026, 8, 1 + i)));
          monthLabel(new Date(Date.UTC(2026, 8, 1 + i)));
        }
        for (let i = 0; i < 30; i++) {
          calendarWhenLabel(new Date(Date.UTC(2026, 8, 1 + (i % 28), 14, 5)).toISOString());
        }
      }
      expect(d).not.toHaveBeenCalled();
      expect(s).not.toHaveBeenCalled();
    } finally {
      d.mockRestore();
      s.mockRestore();
    }
  });

  // The other half: a reused formatter is only a safe swap if it still says the
  // same thing. "Mon" against "Monday" across seven column headers is exactly
  // the kind of change that does not announce itself in a diff.
  it("says exactly what the one-shot formatters said", () => {
    for (const iso of [
      "2026-09-23T14:05:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2026-12-31T23:59:00.000Z",
      "2025-07-04T12:00:00.000Z",
    ]) {
      const when = new Date(iso);
      expect(weekdayLabel(when)).toBe(when.toLocaleDateString("en-US", { weekday: "short" }));
      expect(monthLabel(when)).toBe(when.toLocaleDateString("en-US", { month: "short" }));
      expect(calendarWhenLabel(iso)).toBe(
        when.toLocaleString("en-US", {
          weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        }),
      );
    }
  });

  // Both reasons the overlay draws "Time TBD" — an unscheduled meeting and an
  // unreadable timestamp — have to come back as null, not as "Invalid Date".
  it("returns null for a meeting with no readable time", () => {
    for (const bad of [null, undefined, "", "   ", "not a date", "2026-13-45T99:99:99Z"]) {
      expect(calendarWhenLabel(bad)).toBeNull();
    }
  });

  it("covers a whole week of weekdays without repeating itself", () => {
    const week = Array.from({ length: 7 }, (_, i) => weekdayLabel(new Date(Date.UTC(2026, 8, 28 + i))));
    expect(new Set(week).size).toBe(7);
  });
});

describe("conflictGate", () => {
  it("never lets a save land on a connected calendar's busy time", () => {
    expect(conflictGate({ meetings: 0, blocks: 0, external: 1 }, false)).toBe("blocked");
    expect(conflictGate({ meetings: 0, blocks: 0, external: 1 }, true)).toBe("blocked");
  });

  it("warns about other clashes, and lets Save anyway through", () => {
    expect(conflictGate({ meetings: 1, blocks: 0, external: 0 }, false)).toBe("overridable");
    expect(conflictGate({ meetings: 0, blocks: 1, external: 0 }, false)).toBe("overridable");
    expect(conflictGate({ meetings: 1, blocks: 1, external: 0 }, true)).toBe("ok");
    expect(conflictGate({ meetings: 0, blocks: 0, external: 0 }, false)).toBe("ok");
  });
});

describe("nextFreeStart", () => {
  const T = (h: number, m = 0) => Date.UTC(2026, 9, 5, h, m);
  const span = (a: number, b: number) => ({ start: new Date(a).toISOString(), end: new Date(b).toISOString() });
  const HOUR = 3600_000;

  it("is the start itself when that is free", () => {
    expect(nextFreeStart([span(T(12), T(13))], T(10), HOUR, T(22))).toBe(T(10));
  });

  it("jumps past what it hits, to the next half hour", () => {
    expect(nextFreeStart([span(T(10), T(11, 15))], T(10), HOUR, T(22))).toBe(T(11, 30));
  });

  it("crosses back-to-back events, and skips a gap too short for the meeting", () => {
    const busy = [span(T(10), T(11)), span(T(11), T(12)), span(T(12, 30), T(13))];
    expect(nextFreeStart(busy, T(10), HOUR, T(22))).toBe(T(13));
  });

  it("gives up at the horizon", () => {
    expect(nextFreeStart([span(T(10), T(22))], T(10), HOUR, T(22))).toBeNull();
  });
});

describe("zonedDateTime", () => {
  it("is the inverse of localToIso", () => {
    const iso = localToIso("2026-10-05", "11:30", "America/Chicago");
    expect(zonedDateTime(new Date(iso), "America/Chicago")).toEqual({ date: "2026-10-05", time: "11:30" });
    expect(zonedDateTime(new Date("2026-10-05T23:30:00Z"), "Asia/Tokyo")).toEqual({ date: "2026-10-06", time: "08:30" });
  });
});

describe("findConflictsAcross", () => {
  const W = (start: string, end: string) => ({ startIso: start, endIso: end });
  const row = (id: string, at: string) => ({ id, title: id, scheduled_at: at, duration_minutes: 60, host_id: "u1", attendees: [] });

  it("finds a clash with any meeting of a series, once, earliest first", () => {
    const out = findConflictsAcross(
      [row("late", "2026-09-24T14:00:00.000Z"), row("early", "2026-09-10T14:30:00.000Z")],
      [W("2026-09-10T14:00:00.000Z", "2026-09-10T15:00:00.000Z"), W("2026-09-24T14:00:00.000Z", "2026-09-24T15:00:00.000Z")],
      { subjectHostId: "u1" },
    );
    expect(out.map((c) => c.id)).toEqual(["early", "late"]);
  });

  it("is findConflicts for a single meeting", () => {
    const rows = [row("a", "2026-09-10T14:30:00.000Z")];
    expect(findConflictsAcross(rows, [W("2026-09-10T14:00:00.000Z", "2026-09-10T15:00:00.000Z")], { subjectHostId: "u1" })).toEqual(
      findConflicts(rows, "2026-09-10T14:00:00.000Z", "2026-09-10T15:00:00.000Z", { subjectHostId: "u1" }),
    );
  });
});

describe("overlapsAnyWindow", () => {
  const windows = [{ startIso: "2026-09-10T14:00:00.000Z", endIso: "2026-09-10T15:00:00.000Z" }];
  it("is true for an overlap and false for time that only touches", () => {
    expect(overlapsAnyWindow("2026-09-10T14:30:00.000Z", "2026-09-10T16:00:00.000Z", windows)).toBe(true);
    expect(overlapsAnyWindow("2026-09-10T15:00:00.000Z", "2026-09-10T16:00:00.000Z", windows)).toBe(false);
  });
});
